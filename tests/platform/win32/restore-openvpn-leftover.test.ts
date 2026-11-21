// ─── CODE-AUDIT U-27b: Restore network reaches the OpenVPN leftover clean-up on Windows ───
// 7cbe2f6 taught remove-tunnels.ps1 to stop an openvpn.exe that dvpnd left (its command line names dvpnd's config).
// But Windows runs that elevated step only when leftoverTunnels() finds something, and an openvpn.exe is not in it
// (unelevated, a SYSTEM process's command line is hidden, so ours cannot be told from a user's own): the fix was
// unreachable. Restore network now runs the step whenever any openvpn.exe is running.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({ ovpn: false, steps: 0, step: { ok: true, detail: 'removed: openvpn.exe:4242' } }));
vi.mock('../../../src/main/system/proxy', () => ({ setSystemProxy: vi.fn(), clearSystemProxy: async () => undefined }));
vi.mock('../../../src/main/app-state', () => ({ snapshot: () => ({ session: null }), patch: vi.fn(), setSplitInEffect: vi.fn(), toast: vi.fn() }));
vi.mock('../../../src/main/services/stop-session', () => ({ stopLiveOrCurrent: async () => ({ session: null, dnsRevertFailed: false }) }));
vi.mock('../../../src/main/daemon/manager', () => ({
  daemon: () => ({ listSessions: async () => [], stopSession: async () => ({ killSwitchReleased: false }) }),
  daemonInfo: () => ({ reachable: true }),
  startServiceIfStopped: async () => 'running',
}));
vi.mock('../../../src/main/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../../../src/main/services/history', () => ({ recordStart: vi.fn(), recordEnd: vi.fn() }));
vi.mock('../../../src/main/services/settlement', () => ({ settleChannelSoon: vi.fn(), settlesOnEnd: (r: string) => !/switching servers/i.test(r) }));
vi.mock('../../../src/main/system/dns-check', () => ({ dnsReallyLeftOver: async () => false, flushDnsCache: vi.fn() }));
vi.mock('../../../src/main/system/tunnels', () => ({
  leftoverTunnels: async () => [],
  rivalVpns: async () => [],
  restoreNetworkSweep: () => false, // Windows
  openvpnRunning: async () => st.ovpn,
  removeTunnelServices: async () => { st.steps++; return st.step; },
}));
vi.mock('../../../src/core/chain/rpc', () => ({ getRpcUrls: () => [], resetRpcTransport: vi.fn() }));
vi.mock('../../../src/main/daemon/settings', () => ({ getDaemonSettings: () => ({ settings: { dnsServers: [] } }), splitForSession: vi.fn() }));

const { restoreNetwork } = await import('../../../src/main/services/connection');
const { parseOpenvpnRunning } = await vi.importActual<typeof import('../../../src/main/system/tunnels')>('../../../src/main/system/tunnels');

describe('Restore network with an openvpn.exe running (U-27b)', () => {
  beforeEach(() => { st.ovpn = false; st.steps = 0; st.step = { ok: true, detail: 'removed: openvpn.exe:4242' }; });

  it('runs the elevated step, which stops only dvpnd\'s OpenVPN', async () => {
    st.ovpn = true;
    expect((await restoreNetwork()).ok).toBe(true);
    expect(st.steps).toBe(1);
  });
  it('the step declined or finding only a user\'s own OpenVPN: still ok', async () => {
    st.ovpn = true;
    st.step = { ok: false, detail: 'The administrator permission prompt was declined or closed.' };
    expect((await restoreNetwork()).ok).toBe(true);
  });
  it('negative control: no openvpn.exe, no elevated step (no new admin prompt)', async () => {
    expect((await restoreNetwork()).ok).toBe(true);
    expect(st.steps).toBe(0);
  });
});

describe('parseOpenvpnRunning', () => {
  it('reads tasklist CSV', () => {
    expect(parseOpenvpnRunning('"openvpn.exe","4242","Services","0","9,120 K"\r\n')).toBe(true);
    expect(parseOpenvpnRunning('INFO: No tasks are running which match the specified criteria.\r\n')).toBe(false);
    expect(parseOpenvpnRunning('"openvpn-gui.exe","77","Console","1","5,000 K"')).toBe(false);
  });
});
