// ─── The OpenVPN MSI is installed without its GUI ───
// dvpnd runs openvpn.exe itself. The default MSI features include OpenVPN GUI + "Launch on User
// Logon", which popped up "No readable connection profiles" at every sign-in (test-host 2026-10-24).
// REMOVE= alone on a fresh install turned into REMOVE=ALL: nothing installed, exit 0 (installer 29),
// so the features are named with ADDLOCAL, one list per CPU: the arm64 MSI has no Drivers.Wintun
// and naming it fails with 1603 / error 2711.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync('resources/scripts/install-deps.ps1', 'utf8');
const m = src.match(/\$ovpnFeatures = if \(\$osArch -eq 'arm64'\) \{ '([^']*)' \} else \{ '([^']*)' \}/);
const arm64 = (m?.[1] ?? '').split(',');
const x64 = (m?.[2] ?? '').split(',');
const CORE = ['OpenVPN', 'OpenVPN.Service', 'OpenSSL', 'Drivers', 'Drivers.TAPWindows6', 'Drivers.OvpnDco'];

describe('OpenVPN install', () => {
  it('passes the per-CPU list as ADDLOCAL', () => {
    expect(m).not.toBeNull();
    expect(src).toMatch(/Install-Msi \$ovpn @\("ADDLOCAL=\$ovpnFeatures"\)/);
  });
  it('x64: core, service and drivers, with Wintun', () => {
    for (const f of [...CORE, 'Drivers.Wintun']) expect(x64).toContain(f);
  });
  it('arm64: core, service and drivers, without Wintun (not in the arm64 MSI)', () => {
    for (const f of CORE) expect(arm64).toContain(f);
    expect(arm64).not.toContain('Drivers.Wintun');
  });
  it('leaves out the GUI and its logon autostart, and never uses REMOVE', () => {
    expect([...x64, ...arm64].some((f) => f.startsWith('OpenVPN.GUI'))).toBe(false);
    expect(src).not.toMatch(/REMOVE=OpenVPN/);
  });
  it('keeps the script ASCII (PowerShell 5.1 reads it as cp1252)', () => {
    expect(/^[\x00-\x7F]*$/.test(src)).toBe(true);
  });
});
