// ─── CODE-AUDIT U-37: the device top-up is sent once, not twice by two connects or a lagging read ───
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({ sends: 0, fail: false }));
vi.mock('../../src/core/app/device-setup', () => ({
  deviceTopUpLamports: () => 5_000_000,
  sendDeviceSol: async () => { st.sends += 1; await new Promise((r) => setTimeout(r, 20)); if (st.fail) throw new Error('sent but not confirmed within 60s'); return 'Sig'; },
}));
vi.mock('../../src/main/wallet/vault', () => ({ ownerKeypair: () => ({}), ownerSigner: () => ({}) }));
vi.mock('../../src/main/system/settings', () => ({ getSettings: () => ({ autoTopUpDevice: true }) }));
vi.mock('../../src/main/app-state', () => ({ toast: vi.fn() }));
vi.mock('../../src/main/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { topUpDeviceIfLow, resetTopUp, TOPUP_HOLD_MS } = await import('../../src/main/services/device-topup');
const w = { deviceLamports: 0, ownerLamports: 1e9 } as never;

beforeEach(() => { st.sends = 0; st.fail = false; resetTopUp(); });

describe('topUpDeviceIfLow (U-37)', () => {
  it('two connects at once: one send', async () => {
    const [a, b] = await Promise.all([topUpDeviceIfLow(w, 'Dev', 1000), topUpDeviceIfLow(w, 'Dev', 1000)]);
    expect(st.sends).toBe(1);
    expect(a).toEqual(b);
  });
  it('a send whose confirmation timed out is not followed by a second within the hold', async () => {
    st.fail = true;
    expect((await topUpDeviceIfLow(w, 'Dev', 1000)).done).toBe(false);
    expect(await topUpDeviceIfLow(w, 'Dev', 1000 + TOPUP_HOLD_MS - 1)).toMatchObject({ done: false, reason: 'not-needed' });
    expect(st.sends).toBe(1);
  });
  it('negative control: after the hold a top-up is sent again', async () => {
    await topUpDeviceIfLow(w, 'Dev', 1000);
    await topUpDeviceIfLow(w, 'Dev', 1000 + TOPUP_HOLD_MS);
    expect(st.sends).toBe(2);
  });
});
// The E13 case (Windows settings apply) is in tests/platform/win32/settings-apply-started.test.ts.
