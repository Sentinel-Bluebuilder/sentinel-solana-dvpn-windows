// ─── PowerShell scripts parse and stay ASCII ───
// A parse error only shows once a script runs on a VM or a user's machine
// (e.g. "$var:" inside a string). Parse every .ps1 here first.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { instanceDir } from '../../../src/core/daemon/layout';

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

  // Q0544 (Windows): Apply never overwrites a live config in place (a copy cut by power loss left an empty
  // config.toml). The new file and the rollback both go through Install-FileAtomic: <dst>.new, flush, ReplaceFile.
  it('apply-daemon-config swaps config files in atomically, never copies over them', () => {
    const s = readFileSync('resources/scripts/apply-daemon-config.ps1', 'latin1');
    expect(s).toContain('function Install-FileAtomic');
    expect(s).toContain('$fs.Flush($true)');
    expect(s).toContain('[System.IO.File]::Replace($tmp, $To');
    expect(s).toContain('Install-FileAtomic $p.src $p.dst');
    expect(s).toContain('Install-FileAtomic "$($p.dst).bak" $p.dst');
    // The only Copy-Item onto a destination is the .bak backup and the .new temp file.
    expect(s).not.toMatch(/Copy-Item[^\n]*-Destination \$p\.dst\b/);
    // migrate-daemon-config (installer / setup) rewrites the same files: also <path>.new + ReplaceFile.
    const m = readFileSync('resources/scripts/migrate-daemon-config.ps1', 'latin1');
    expect(m).toContain('function Write-FileAtomic');
    expect(m).toContain('[System.IO.File]::Replace($tmp, $Path');
    expect(m).not.toContain('WriteAllText(');
  });

  // The service runs protocol programs found on its own PATH as SYSTEM: only the app's folders and the
  // Windows system folders, never the machine PATH (a user-writable folder on it would run as SYSTEM).
  it('setup-daemon gives the service a PATH without the machine PATH, and refuses a user-writable app folder', () => {
    const s = readFileSync('resources/scripts/setup-daemon.ps1', 'latin1');
    expect(s).not.toMatch(/GetEnvironmentVariable\('Path', 'Machine'\)/);
    expect(s).toMatch(/\$svcPath = \(\$dirs \+ @\("\$sys\\System32"/);
    // The whole ancestor chain to the volume root must be admin-only (a user-writable parent lets a
    // standard user swap the leaf), not just the leaf — FWX ancestor walk, d3155da.
    expect(s).toMatch(/Assert-AdminOnlyChain \$binDir/);
    expect(s).toMatch(/Assert-AdminOnlyChain \$BinRoot/);
    // and the lock runs after cb33's `service install` (which resets the instance folder's DACL)
    expect(s.indexOf("lock-daemon-home.ps1') -DaemonHome $DaemonHome")).toBeGreaterThan(s.indexOf('service install --instance'));
  });

  // WINROWS 11-09: PowerShell 5.1 under EAP Stop throws on net.exe's stderr, so a second daemon install for a user
  // already in the group failed with "System error 1378" before the 1378 check. The native call runs under Continue.
  it('setup-daemon adds the user to the group with EAP Continue, so "already a member" (1378) is not fatal', () => {
    const s = readFileSync('resources/scripts/setup-daemon.ps1', 'latin1');
    const call = s.indexOf('& net.exe localgroup $group $User /add 2>&1');
    expect(call).toBeGreaterThan(0);
    const before = s.slice(0, call);
    expect(before.lastIndexOf("$ErrorActionPreference = 'Continue'")).toBeGreaterThan(before.lastIndexOf("$ErrorActionPreference = 'Stop'"));
    const after = s.slice(call);
    expect(after.indexOf('$addCode = $LASTEXITCODE')).toBeLessThan(after.indexOf("$ErrorActionPreference = 'Stop'"));
    expect(after).toMatch(/if \(\$addCode -eq 0\) \{ \$relogin = \$true \}/);
    expect(after).toMatch(/-notmatch '1378'/);
  });

  // Q0548: `service install` sets the restart policy only when it creates the service, so upgrades kept the 24 h
  // reset (a third crash in a day waited 5 min under the kill switch). setup-daemon sets it on every run, after the
  // install, outside the "no service yet" branch, with dvpnd 6.10's values.
  it('setup-daemon sets the service restart policy on every run (upgrades too), 1 h reset', () => {
    const s = readFileSync('resources/scripts/setup-daemon.ps1', 'latin1');
    const policy = s.indexOf('& sc.exe failure $Service reset= 3600 actions= restart/5000/restart/30000/restart/300000');
    expect(policy).toBeGreaterThan(0);
    expect(policy).toBeGreaterThan(s.indexOf('service install --instance'));
    const branch = s.indexOf('if (-not $svc) {');
    expect(branch).toBeGreaterThan(0);
    expect(policy).toBeGreaterThan(s.indexOf('}', s.indexOf('service install failed', branch)));
  });

  // Q0576: rc.2 installed from a PowerShell 7 window: every 5.1 child inherited 7's PSModulePath, setup-daemon's
  // Get-Acl failed in Import-Module after one second and the update left the service stopped, with no record.
  it('installer clears PSModulePath before any PowerShell child, in the installer and the uninstaller', () => {
    const nsh = readFileSync('build/installer.nsh', 'latin1');
    expect(nsh).toMatch(/!macro ddvCleanPsEnv\s+System::Call 'kernel32::SetEnvironmentVariable\(t "PSModulePath", p 0\)'/);
    const find = nsh.indexOf('!macro ddvFindPowerShell OUT');
    expect(nsh.indexOf('!insertmacro ddvCleanPsEnv', find)).toBeLessThan(nsh.indexOf('!macroend', find));
    // the macros sit outside the BUILD_UNINSTALLER blocks, and every nsExec runs after a ddvFindPowerShell
    expect(find).toBeLessThan(nsh.indexOf('!ifndef BUILD_UNINSTALLER'));
    for (const [hook, ps] of [['!macro customInit', '$ddvPs'], ['!macro customUnInit', '$ddvUnPs']]) {
      const at = nsh.indexOf(hook);
      expect(nsh.indexOf(`!insertmacro ddvFindPowerShell ${ps}`, at)).toBeLessThan(nsh.indexOf('nsExec::', at));
    }
    // the path it was started with is read BEFORE it is cleared (for install-update.log)
    const init = nsh.indexOf('!macro customInit');
    expect(nsh.indexOf('ReadEnvStr $ddvPsPathIn PSModulePath', init)).toBeLessThan(nsh.indexOf('!insertmacro ddvFindPowerShell $ddvPs', init));
  });

  it('an update records setup-daemon in c0\\install-update.log and starts the service plainly if it failed', () => {
    const nsh = readFileSync('build/installer.nsh', 'latin1');
    const at = nsh.indexOf('-File "$INSTDIR\\resources\\resources\\scripts\\setup-daemon.ps1"');
    expect(at).toBeGreaterThan(0);
    const after = nsh.slice(at, nsh.indexOf('!macroend', at));
    expect(after).toContain('!insertmacro ddvUpdateLog "$5\\sentinel-dvpn\\c0" "setup-daemon" $0 "$PLUGINSDIR\\setup-daemon.json"');
    expect(after).toMatch(/\$\{If\} \$0 != "0"[\s\S]*Start-Service -Name sentinel-dvpnd`\$\$c0[\s\S]*"start-fallback"[\s\S]*MessageBox[^\n]*\/SD IDOK/);
    expect(nsh).toMatch(/FileOpen \$R0 "\$\{DIR\}\\install-update\.log" a/);
  });

  it('setup-daemon and uninstall-cleanup reset PSModulePath to the machine value before any cmdlet', () => {
    const reset = "$env:PSModulePath = [Environment]::GetEnvironmentVariable('PSModulePath', 'Machine')";
    const s = readFileSync('resources/scripts/setup-daemon.ps1', 'latin1');
    expect(s.indexOf(reset)).toBeGreaterThan(s.indexOf("if ($MyInvocation.InvocationName -eq '.') { return }"));
    expect(s.indexOf(reset)).toBeLessThan(s.indexOf('Assert-AdminOnlyChain $binDir'));
    const u = readFileSync('resources/scripts/uninstall-cleanup.ps1', 'latin1');
    expect(u.indexOf(reset)).toBeGreaterThan(0);
    expect(u.indexOf(reset)).toBeLessThan(u.indexOf('Get-ItemProperty'));
  });

  it.runIf(process.platform === 'win32')('parse with no errors', () => {
    const list = files.map((f) => `'${f.replace(/'/g, "''")}'`).join(',');
    const cmd = `foreach ($f in @(${list})) { $e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $f), [ref]$null, [ref]$e); foreach ($x in $e) { "$f line $($x.Extent.StartLineNumber): $($x.Message)" } }`;
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', timeout: 60_000 });
    expect(out.trim()).toBe('');
  }, 70_000);
});
