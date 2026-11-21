// ─── No sign-out after the first service install (owner 2026-11-12) ───
// A user added to the sentinel-dvpn group holds it only after the next sign-in, so the fresh-install
// app was locked out ("sign out and back in"). The elevated steps now give the user's own SID the pipe
// (pipe-bridge.exe -grant via grant-pipe.ps1) and Connect runs that step itself when the link is refused.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

const read = (p: string): string => readFileSync(p, 'utf8');

describe('pipe grant wiring', () => {
  it('the install step grants the user straight after starting the service, and only then drops relogin', () => {
    const s = read('resources/scripts/setup-daemon.ps1');
    const start = s.indexOf("Start-Service -Name $Service\n");
    const grant = s.indexOf("'grant-pipe.ps1') -Bridge (Join-Path $BinRoot 'pipe-bridge.exe') -User $User");
    expect(start).toBeGreaterThan(0);
    expect(grant).toBeGreaterThan(start);
    expect(s.slice(grant, grant + 300)).toMatch(/if \(\$LASTEXITCODE -eq 0\) \{ \$relogin = \$false \}/);
  });
  it('a settings restart re-grants (the grant lives only until the service restarts)', () => {
    const s = read('resources/scripts/apply-daemon-config.ps1');
    expect(s).toMatch(/if \(\$svc -and \$Bridge -and \$User\) \{\s+try \{\s+& \(Join-Path \$PSScriptRoot 'grant-pipe\.ps1'\)/);
    const st = read('src/main/daemon/settings.ts');
    expect(st).toContain('const user = appUserAccount();');
    expect(st).toContain("Bridge: binPath('pipe-bridge.exe'), ...(user ? { User: user } : {}) }");
  });
  it('connect runs the grant before waiting for the service when the link is refused', () => {
    const s = read('src/main/services/connection.ts');
    const g = s.indexOf('const g = await grantPipeAccess();');
    const w = s.indexOf('d = await whileWatched(() => waitForDaemon(SERVICE_WAIT_MS, daemonInfo));');
    expect(g).toBeGreaterThan(0);
    expect(g).toBeLessThan(w);
    // Q0521: never during a service restart, when a moment of "access denied" is not a missing grant.
    expect(s).toMatch(/daemonInfo\(\)\.error === RELOGIN_COPY && !serviceInTransition\(\)\) \{/);
  });
  it('the bridge grants exactly the rights the group has, nothing more', () => {
    const go = read('tools/pipe-bridge/grant.go');
    expect(go).toContain('AccessPermissions: daemonClientRights,');
    expect(read('tools/pipe-bridge/main.go')).toContain('const daemonClientRights = 0x120183');
    expect(go).toContain('strings.HasPrefix(sidText, "S-1-5-21-")');
  });
  it('Q0488: install and the app grant list the user in pipe-allow.txt (dvpnd final6.7 applies it to every pipe); uninstall removes it', () => {
    const g = read('resources/scripts/grant-pipe.ps1');
    expect(g).toContain("if ($Persist -eq '1') {");
    // Windows 11 does not log SCM event 7036, so the cd7e9d6 start-event task never ran (DVPN-WIN proof).
    expect(g).not.toContain('EventID=7036');
    expect(g).not.toContain('Register-ScheduledTask');
    expect(g).toContain("$allow = Join-Path $dhome 'pipe-allow.txt'");
    // dvpnd trusts the file only when SYSTEM/Administrators alone own and can change it.
    expect(g).toContain("$acl.SetOwner((New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')))");
    expect(g).toContain('$acl.SetAccessRuleProtection($true, $false)');
    expect(g).toContain("foreach ($s in 'S-1-5-18', 'S-1-5-32-544') {");
    expect(g).toContain("Get-ScheduledTask -TaskName 'devnet-dvpn-pipe-grant-*'"); // upgrade: old tasks go
    expect(g).toMatch(/for \(\$i = 0; \$i -lt 15; \$i\+\+\) \{/); // pipe not up yet right after a start
    expect(read('resources/scripts/setup-daemon.ps1')).toContain('-User $User -Service $Service -Persist 1 | Out-Null');
    expect(read('src/main/daemon/manager.ts')).toContain("Service: DAEMON_SERVICE, Persist: '1' });");
    const u = read('resources/scripts/uninstall-cleanup.ps1');
    expect(u).toContain("$allow = Join-Path $home0 'pipe-allow.txt'");
    expect(u).toContain("Get-ScheduledTask -TaskName 'devnet-dvpn-pipe-grant-*'");
  });
  it('the banner no longer tells the user to sign out', () => {
    // Windows keeps its words (osPick win32); other OSes say "your system asks" (all-OS port).
    expect(read('src/renderer/src/App.tsx')).toContain("{osPick({ win32: tr('One last step: press Connect and Windows asks once to finish setting up the VPN service.') }, tr('One last step: press Connect and your system asks once to finish setting up the VPN service.'))}");
  });
});

// Runs the real script unelevated: it must refuse bad input before touching anything.
describe.runIf(process.platform === 'win32')('grant-pipe.ps1 refuses unsafe input', () => {
  const run = (args: string[]): { code: number; result: { status: string; detail: string } | null } => {
    const dir = mkdtempSync(join(tmpdir(), 'ddv-grant-'));
    const result = join(dir, 'r.json');
    let code = 0;
    try {
      execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'resources/scripts/grant-pipe.ps1', ...args, '-Result', result], { stdio: 'pipe' });
    } catch (err) {
      code = (err as { status: number }).status;
    }
    const r = existsSync(result) ? JSON.parse(readFileSync(result, 'utf8').replace(/^\uFEFF/, '')) : null;
    rmSync(dir, { recursive: true, force: true });
    return { code, result: r };
  };
  it('a service name outside sentinel-dvpnd$<tag>', () => {
    const r = run(['-Bridge', 'C:\\x\\pipe-bridge.exe', '-User', 'S-1-5-21-1-2-3-1001', '-Service', 'Spooler']);
    expect(r.code).toBe(1);
    expect(r.result?.detail).toMatch(/unexpected service name/);
  });
  it('any program not named pipe-bridge.exe', () => {
    const r = run(['-Bridge', 'C:\\Windows\\System32\\cmd.exe', '-User', 'S-1-5-21-1-2-3-1001']);
    expect(r.code).toBe(1);
    expect(r.result?.detail).toMatch(/unexpected bridge binary name/);
  });
  it('a pipe-bridge.exe in a folder the user can change (it would run as admin)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ddv-bridge-'));
    const fake = join(dir, 'pipe-bridge.exe');
    copyFileSync('C:\\Windows\\System32\\whoami.exe', fake);
    const r = run(['-Bridge', fake, '-User', 'S-1-5-21-1-2-3-1001']);
    rmSync(dir, { recursive: true, force: true });
    expect(r.code).toBe(1);
    expect(r.result?.detail).toMatch(/can be changed by/);
  });
});
