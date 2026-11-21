// ─── KSM13 blk × ks-off (AND-34, apk14): the held view after a dropped session is taken down when the block goes ───
// Engine killed under the kill switch → ended() shows the one held screen (Restore network). Then kill switch Off
// + Apply (CLI or app): the VPN interface was released and the internet was back, but the screen kept "Connection
// failed … still blocking" for good: ended()'s view was not marked as a blocked view this module put up, so the
// check after the restart returned early. And on Android "the internet answers" proves nothing (this app's own
// traffic is outside the VPN): the takedown asks the VPN interface instead.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({
  state: { session: null as unknown, conn: { phase: 'idle', title: 'Not connected' } as Record<string, unknown> },
  list: [] as Array<{ id: string; status: string; error?: string }>,
  held: true as boolean | null,
  netUp: true,
}));
vi.mock('../../../src/shared/is-android', () => ({ isAndroid: () => true }));
vi.mock('../../../src/main/android/android-bridge', () => ({ androidHeldBlock: async () => st.held }));
vi.mock('../../../src/main/host', () => ({ getHost: () => ({ dataDir: '.' }) }));
vi.mock('../../../src/main/app-state', () => ({
  snapshot: () => st.state,
  patch: (p: Record<string, unknown>) => { Object.assign(st.state, p); },
  setSplitInEffect: vi.fn(), setWholeDeviceInEffect: vi.fn(), setRedialFollow: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('../../../src/main/daemon/manager', () => ({
  daemon: () => ({
    listSessions: async () => st.list.map((s) => ({ node: 'N', service: 'wireguard', channel: '', ...s })),
    watchSession: () => () => undefined,
  }),
  daemonInfo: () => ({ reachable: true, device: 'Dev', networkOk: true }),
  startServiceIfStopped: async () => 'ok',
}));
vi.mock('../../../src/main/services/service-transition', () => ({
  serviceInTransition: () => false, beginServiceTransition: vi.fn(), applyMarkerFresh: () => false, onTransitionSettled: () => () => undefined, onTransitionBegan: () => () => undefined, RESTARTING_COPY: 'restarting',
}));
vi.mock('../../../src/main/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../../src/main/system/tunnels', () => ({ leftoverTunnels: async () => [], rivalVpns: async () => [], removeTunnelServices: async () => undefined }));
vi.mock('../../../src/main/system/proxy', () => ({ setSystemProxy: vi.fn(), clearSystemProxy: async () => undefined }));
vi.mock('../../../src/main/services/history', () => ({ recordStart: vi.fn(), recordEnd: vi.fn(), closeHistoryFrom: vi.fn() }));
vi.mock('../../../src/main/services/settlement', () => ({ settleChannelSoon: vi.fn(), settlesOnEnd: () => false }));
vi.mock('../../../src/main/system/dns-check', () => ({ dnsReallyLeftOver: async () => false, flushDnsCache: vi.fn() }));
vi.mock('../../../src/main/daemon/settings', () => ({ getDaemonSettings: () => ({ settings: { killSwitch: 'persist', dnsServers: [] } }), serviceUsesTun: () => false, splitForSession: vi.fn() }));
vi.mock('../../../src/core/quality/reachability', () => ({ internetReachable: async () => st.netUp }));
vi.mock('../../../src/core/chain/rpc', () => ({ getRpcUrls: () => [], resetRpcTransport: vi.fn(), onRpcRetry: () => () => undefined }));

const { reconcileShownSession, checkLeftoverBlock } = await import('../../../src/main/services/connection');

async function dropShownSession(): Promise<void> {
  st.state.session = { id: 's1', node: 'N', service: 'wireguard', channel: '' };
  st.state.conn = { phase: 'connected', title: 'Protected' };
  st.list = [{ id: 's1', status: 'ended', error: 'the connection to this server stopped working' }];
  await reconcileShownSession(); // first miss
  await reconcileShownSession(); // cleared: ended() puts up the held view
  st.list = [];
}

describe('the held view after a dropped session (Android, kill switch on)', () => {
  beforeEach(() => {
    st.held = true;
    st.netUp = true; // this app's own traffic always reaches the internet on Android
  });

  it('is shown at once, stays while the VPN interface is held, and goes when the block is released (kill switch Off + Apply)', async () => {
    await dropShownSession();
    expect(st.state.conn.phase).toBe('error');
    expect(st.state.conn.restoreNetwork).toBe(true);
    expect(await checkLeftoverBlock()).toBe(true); // still held: the view stays
    expect(st.state.conn.phase).toBe('error');
    st.held = false; // released by the Apply
    expect(await checkLeftoverBlock()).toBe(false);
    expect(st.state.conn.phase).toBe('idle');
    expect(st.state.conn.restoreNetwork).toBeFalsy();
  });

  it('control: "the internet answers" alone never takes it down on Android (the block still holds every other app)', async () => {
    await dropShownSession();
    st.netUp = true;
    st.held = true;
    expect(await checkLeftoverBlock()).toBe(true);
    expect(st.state.conn.phase).toBe('error');
    expect(st.state.conn.restoreNetwork).toBe(true);
    st.held = null; // unreadable: keep it (Restore network stays offered)
    expect(await checkLeftoverBlock()).toBe(true);
    expect(st.state.conn.phase).toBe('error');
  });
});

// AND-34 KSM13 blk × split-exc: after the engine kill dvpnd no longer listed the shown session AT ALL; the
// reconcile took a missing row for a user close ('closed by client') and showed "Not connected" while the kill
// switch still blocked. dvpnd keeps the row of a client close with its reason, so a missing row ended with the service.
describe('a shown session whose row is gone from dvpnd (Android, kill switch on)', () => {
  it('ends as a service end (held view + Restore network), not as a user close', async () => {
    st.held = true;
    st.state.session = { id: 's9', node: 'N', service: 'wireguard', channel: '' };
    st.state.conn = { phase: 'connected', title: 'Protected' };
    st.list = []; // no row at all
    await reconcileShownSession(); // first miss
    await reconcileShownSession(); // cleared
    expect(st.state.session).toBeNull();
    expect(st.state.conn.phase).toBe('error');
    expect(st.state.conn.restoreNetwork).toBe(true);
  });

  it('control: a row ended by the client stays a user close (no held view)', async () => {
    st.held = true;
    st.state.session = { id: 's10', node: 'N', service: 'wireguard', channel: '' };
    st.state.conn = { phase: 'connected', title: 'Protected' };
    st.list = [{ id: 's10', status: 'ended', error: 'closed by client' }];
    await reconcileShownSession();
    await reconcileShownSession();
    expect(st.state.session).toBeNull();
    expect(st.state.conn.restoreNetwork).toBeFalsy();
    st.list = [];
  });
});
