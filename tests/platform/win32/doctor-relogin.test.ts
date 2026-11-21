// Windows only: the fresh-install sign-in step (split from tests/unit/doctor-parse.test.ts, all-OS port).
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/main/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../src/main/system/elevate', () => ({ runElevated: vi.fn() }));
vi.mock('../../../src/main/store', () => ({ readJson: vi.fn(), writeJson: vi.fn() }));

// cb33 opens the Windows pipe to the sentinel-dvpn group only; Windows applies a new group at sign-in.
describe('fresh-install sign-in step', async () => {
  const { daemonLinkCopy } = await import('../../../src/core/daemon/link-copy');
  const { appUserAccount, needsRelogin } = await import('../../../src/main/daemon/manager');
  it('setup-daemon\'s "relogin-needed" is read; plain installs are not', () => {
    expect(needsRelogin('service installed and running; relogin-needed')).toBe(true);
    expect(needsRelogin('service installed and running')).toBe(false);
    expect(needsRelogin(undefined)).toBe(false);
  });
  it('access denied names the one step that fixes it, never a sign-out (owner 2026-11-12; row 127)', () => {
    const s = daemonLinkCopy('14 UNAVAILABLE: connect EACCES (pipe)');
    expect(s).toMatch(/not allowed to talk to the VPN service yet\. Press Finish setup/);
    expect(s).not.toMatch(/sign out/i);
  });
  it('the app passes its own account to the elevated script', () => {
    expect(appUserAccount({ USERDOMAIN: 'PC1', USERNAME: 'alex' })).toBe('PC1\\alex');
    expect(appUserAccount({ USERNAME: 'alex' })).toBe('alex');
  });
});
