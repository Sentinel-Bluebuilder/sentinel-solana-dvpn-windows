// ─── rc9-c OWNER-PENDING (the macOS app b1750da48 shape): an adopted service key makes the install step run once ───
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const st = vi.hoisted(() => ({ args: null as Record<string, string> | null, status: 'ok' }));
vi.mock('../../src/main/system/elevate', async (orig) => ({
  ...(await orig<object>()),
  runElevated: async (_s: string, args: Record<string, string>) => { st.args = args; return { status: st.status, detail: 'service installed and running' }; },
}));

const B = '9enW4xCJrmytnEC6VsJYPbcT2ng3QTUwUkAHSrKR9Xrj';
const SVC = 'CWT5iHdi76j2wGkfWcs8NXAUyPwJ44A7ZGAdGoYFRaf9';
const { setHost } = await import('../../src/main/host');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opend-'));
setHost({ name: 'cli', resourcesDir: path.resolve('resources'), dataDir, keyStore: {} as never, emit: () => undefined });
const m = await import('../../src/main/daemon/manager');
const { writeJson, initStore } = await import('../../src/main/store');
initStore(dataDir);

beforeEach(() => { writeJson('service-owner-pending.json', null); writeJson('device.json', null); st.args = null; st.status = 'ok'; });

describe('owner pending after E-ST adoption', () => {
  it('adoptInstalledDevice(B): register(SvcKey, B) and markOwnerPending(B)', async () => {
    const reg: unknown[] = []; const marked: string[] = [];
    const got = await m.adoptInstalledDevice(B, { record: () => null, home: 'C:\\ProgramData\\sentinel-dvpn\\c0', has: () => true, detect: async () => ({ ok: true, device: SVC }), register: (d, o, h) => { reg.push([d, o, h]); }, markOwnerPending: (o) => { marked.push(o); } });
    expect(got).toBe(SVC);
    expect(reg).toEqual([[SVC, B, 'C:\\ProgramData\\sentinel-dvpn\\c0']]);
    expect(marked).toEqual([B]);
  });
  it('installPending is true with nothing staged while an owner is pending; false otherwise', () => {
    expect(m.installPending()).toBe(false);
    writeJson('service-owner-pending.json', { owner: B, at: 1 });
    expect(m.ownerPending()).toBe(B);
    expect(m.installPending()).toBe(true);
  });
  it('installService passes Owner and clears the pending mark on ok', async () => {
    m.registerDevice(SVC, B, 'C:\\ProgramData\\sentinel-dvpn\\c0');
    writeJson('service-owner-pending.json', { owner: B, at: 1 });
    const r = await m.installService();
    expect(r.ok).toBe(true);
    expect(st.args).toMatchObject({ Owner: B });
    expect(m.ownerPending()).toBeNull();
  });
  it('a failed install keeps the mark (the next connect tries again)', async () => {
    m.registerDevice(SVC, B, 'C:\\ProgramData\\sentinel-dvpn\\c0');
    writeJson('service-owner-pending.json', { owner: B, at: 1 });
    st.status = 'error';
    await m.installService();
    expect(m.ownerPending()).toBe(B);
  });
});
