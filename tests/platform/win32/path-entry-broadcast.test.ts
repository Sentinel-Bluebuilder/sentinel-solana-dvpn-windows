// ─── WIN-W11 (the agent tools rc.9, Windows testing audit W-11): the installer's PATH change is announced to running programs ───
// path-entry.ps1 wrote the machine PATH in the registry and told no one: a terminal opened from the Explorer that
// was already running had no `devnet-dvpn` until the user signed out. Windows' own way is WM_SETTINGCHANGE with
// "Environment" to every top-level window. (Static checks: this box has no PowerShell; the installer run on the
// Windows VM is the live proof.)
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = fs.readFileSync('resources/scripts/path-entry.ps1', 'utf8');

describe('WIN-W11: path-entry.ps1 broadcasts WM_SETTINGCHANGE', () => {
  it('after the registry write: SendMessageTimeout(HWND_BROADCAST, WM_SETTINGCHANGE, 0, "Environment", SMTO_ABORTIFHUNG, 5000)', () => {
    const write = src.indexOf("$reg.SetValue('Path'");
    const send = src.indexOf('SendMessageTimeout(');
    expect(write).toBeGreaterThan(0);
    expect(send).toBeGreaterThan(write);
    expect(src).toMatch(/\[IntPtr\]0xffff, 0x1A, \[UIntPtr\]::Zero, 'Environment', 2, 5000/);
  });
  it('a failed broadcast is a warning: the PATH entry stays and the script still exits 0', () => {
    expect(src).toMatch(/catch \{ Write-Output "PATH: broadcast failed \(new terminals see it after sign-in\): \$\(\$_\.Exception\.Message\)" \}/);
  });
  it('the value is still written raw as REG_EXPAND_SZ (never [Environment]::SetEnvironmentVariable, which writes REG_SZ)', () => {
    expect(src).toContain('[Microsoft.Win32.RegistryValueKind]::ExpandString');
    expect(src).not.toMatch(/SetEnvironmentVariable\(/);
  });
  it('ASCII only (PowerShell 5.1 reads a BOM-less file as ANSI)', () => {
    expect(/^[\x00-\x7f]*$/.test(src)).toBe(true);
  });
});
