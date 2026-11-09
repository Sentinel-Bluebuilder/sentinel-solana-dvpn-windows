// ─── PowerShell scripts parse and stay ASCII ───
// A parse error only shows once a script runs on a VM or a user's machine
// (e.g. "$var:" inside a string). Parse every .ps1 here first.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { instanceDir } from '../../src/core/daemon/layout';

const DIRS = ['scripts/e2e', 'resources/scripts'];
const files = DIRS.flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.ps1')).map((f) => join(d, f)));

describe('PowerShell scripts', () => {
  it('finds the scripts', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it('are ASCII (PowerShell 5.1 reads them as cp1252)', () => {
    const bad = files.filter((f) => /[^\x00-\x7f]/.test(readFileSync(f, 'latin1')));
    expect(bad).toEqual([]);
  });

  // The installer calls it with no arguments: a wrong default silently migrated nothing (VMs 2026-10-21).
  it('migrate-daemon-config defaults to the service home the app uses', () => {
    const s = readFileSync('resources/scripts/migrate-daemon-config.ps1', 'latin1');
    // cb33: the client instance c0 (layout.ts instanceDir), the same folder manager.ts DEFAULT_DAEMON_HOME uses.
    expect(s).toContain("Join-Path $env:ProgramData 'sentinel-dvpn\\c0'");
    expect(readFileSync('src/main/daemon/manager.ts', 'utf8')).toContain("instanceDir('win32'");
    expect(instanceDir('win32')).toBe('C:\\ProgramData\\sentinel-dvpn\\c0');
  });

  // Every elevated script and the installer name the cb33 service and binary; the old names appear only
  // where a pre-cb33 install is cleaned up or moved.
  it('use the cb33 service and binary names', () => {
    for (const f of ['setup-daemon.ps1', 'apply-daemon-config.ps1', 'service-user-start.ps1']) {
      const s = readFileSync(`resources/scripts/${f}`, 'latin1');
      expect(s, f).toContain("'sentinel-dvpnd$c0'");
      expect(s, f).not.toMatch(/'dvpnd'/);
    }
    expect(readFileSync('resources/scripts/setup-daemon.ps1', 'latin1')).toContain("-ne 'sentinel-dvpnd.exe'");
    const nsh = readFileSync('build/installer.nsh', 'latin1');
    expect(nsh).toContain('bin\\sentinel-dvpnd.exe');
    expect(nsh).toContain('daemon migrate --yes --legacy-dvpnd');
    expect(nsh).not.toMatch(/-Dvpnd "\$PLUGINSDIR\\dvpnd\.exe"/);
  });

  // The service runs protocol programs found on its own PATH as SYSTEM: only the app's folders and the
  // Windows system folders, never the machine PATH (a user-writable folder on it would run as SYSTEM).
  it('setup-daemon gives the service a PATH without the machine PATH, and refuses a user-writable app folder', () => {
    const s = readFileSync('resources/scripts/setup-daemon.ps1', 'latin1');
    expect(s).not.toMatch(/GetEnvironmentVariable\('Path', 'Machine'\)/);
    expect(s).toMatch(/\$svcPath = \(\$dirs \+ @\("\$sys\\System32"/);
    // The whole ancestor chain to the volume root must be admin-only (a user-writable parent lets a
    // standard user swap the leaf), not just the leaf — QA ancestor walk, d3155da.
    expect(s).toMatch(/Assert-AdminOnlyChain \$binDir/);
    expect(s).toMatch(/Assert-AdminOnlyChain \$BinRoot/);
    // and the lock runs after cb33's `service install` (which resets the instance folder's DACL)
    expect(s.indexOf("lock-daemon-home.ps1') -DaemonHome $DaemonHome")).toBeGreaterThan(s.indexOf('service install --instance'));
  });

  it.runIf(process.platform === 'win32')('parse with no errors', () => {
    const list = files.map((f) => `'${f.replace(/'/g, "''")}'`).join(',');
    const cmd = `foreach ($f in @(${list})) { $e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $f), [ref]$null, [ref]$e); foreach ($x in $e) { "$f line $($x.Extent.StartLineNumber): $($x.Message)" } }`;
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', timeout: 60_000 });
    expect(out.trim()).toBe('');
  }, 70_000);
});
