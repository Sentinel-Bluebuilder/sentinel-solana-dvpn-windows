// ─── `daemon drivers`: a missing driver names the servers it affects (blind round 2) ───
import { describe, it, expect } from 'vitest';
import { driversMissingTail } from '../../../src/cli/daemon-cmd';

const report = (rows: [string, string][]) => ({ at: '', ok: false, rebootRequired: false, deps: rows.map(([name, status]) => ({ name, status })) }) as never;

describe('driversMissingTail', () => {
  it('only AmneziaWG missing: says only AmneziaWG servers need it', () => {
    expect(driversMissingTail(report([['wireguard', 'present'], ['amneziawg', 'missing'], ['openvpn', 'installed']])))
      .toBe('Some drivers are missing: AmneziaWG. Only AmneziaWG servers need it; the others work now. To fix it: "daemon repair-drivers --yes".');
  });
  it('OpenVPN and its adapter: one protocol named once', () => {
    expect(driversMissingTail(report([['openvpn', 'failed'], ['openvpn-wintun', 'missing']])))
      .toBe('Some drivers are missing: OpenVPN, OpenVPN Wintun adapter. Only OpenVPN servers need it; the others work now. To fix it: "daemon repair-drivers --yes".');
  });
  it('two protocols joined with "and"', () => {
    expect(driversMissingTail(report([['wireguard', 'missing'], ['amneziawg', 'missing']])))
      .toContain('Only WireGuard and AmneziaWG servers need it');
  });
  it('negative control: a row that is not a protocol driver (Windows, the driver list) blocks everything', () => {
    expect(driversMissingTail(report([['windows', 'incompatible'], ['amneziawg', 'missing']])))
      .toBe('Some drivers are missing: Windows (64-bit), AmneziaWG. No server can be used until it is fixed: run "daemon repair-drivers --yes".');
  });
});
