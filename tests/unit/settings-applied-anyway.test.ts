// fleet-bugs #3: an admin step can report an error after the change applied.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main/daemon/manager', () => ({ DAEMON_SERVICE: 'sentinel-dvpnd$c0', DEFAULT_DAEMON_HOME: 'C:/x', daemonInfo: () => ({}), deviceRecord: () => null, relinkDaemon: () => {}, scriptPath: (s: string) => s, startServiceIfStopped: async () => 'running' }));
vi.mock('../../src/main/system/elevate', () => ({ runElevated: async () => ({ status: 'error', detail: 'x' }) }));
vi.mock('../../src/main/logger', () => ({ log: { info: () => {}, warn: () => {} } }));
vi.mock('../../src/main/host', () => ({ getHost: () => ({ dataDir: 'C:/d' }) }));

describe('appliedAnyway (cb33: one instance config.toml)', async () => {
  const { appliedAnyway } = await import('../../src/main/daemon/settings');
  const staged = 'a = 1\n[network]\nkill_switch = "off"\n';
  it('live equal to staged with the service running = applied (CRLF ignored)', () => {
    expect(appliedAnyway(staged, 'a = 1\r\n[network]\r\nkill_switch = "off"\r\n', true)).toBe(true);
  });
  it('a rolled-back or different file is not applied', () => {
    expect(appliedAnyway(staged, staged.replace('a = 1', 'a = 2'), true)).toBe(false);
  });
  it('a stopped service or unreadable config is not applied', () => {
    expect(appliedAnyway(staged, staged, false)).toBe(false);
    expect(appliedAnyway(staged, null, true)).toBe(false);
  });
});
