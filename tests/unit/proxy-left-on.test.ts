// ─── Q0281: our own SOCKS proxy is never restored as "what the user had" ───
// wx1 (twice): after 'proxy off' + 'disconnect' the system proxy stayed socks=127.0.0.1:1080 with no
// session, so every WinINET app had no internet. Once our proxy was on with no backup, the next
// 'proxy on' saved it as the user's setting and every later 'proxy off' put it back.
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setHost } from '../../src/main/host';
import { initStore } from '../../src/main/store';
import { clearSystemProxy, isOurs, savedState, setProxyRunner, setSocksCheck, setSystemProxy, systemProxyActive, systemProxyLive, type ProxyState } from '../../src/main/system/proxy';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvpn-q281-'));
beforeAll(() => {
  setHost({ name: 'cli', resourcesDir: dir, dataDir: dir, emit: () => undefined, keyStore: { kind: 'memory', exists: () => false, load: () => null, save: () => undefined, remove: () => undefined } });
  initStore(dir);
  setSocksCheck(async () => ({ ok: true, reason: 'stub' }));
});

const OURS: ProxyState = { flags: 3, server: 'socks=127.0.0.1:1080', bypass: '<local>', pac: '' };
const DIRECT: ProxyState = { flags: 1, server: '', bypass: '', pac: '' };
const fake = (start: ProxyState) => {
  let cur = { ...start };
  setProxyRunner({ query: async () => ({ ...cur }), set: async (s) => { cur = { ...s }; return { ...cur }; } });
  return { now: () => cur, change: (s: ProxyState) => { cur = { ...s }; } };
};

describe('system proxy left on (Q0281)', () => {
  it('knows its own proxy by shape, any loopback port', () => {
    expect(isOurs(OURS)).toBe(true);
    expect(isOurs({ flags: 3, server: 'socks=127.0.0.1:10808' })).toBe(true);
    expect(isOurs({ flags: 1, server: 'socks=127.0.0.1:1080' })).toBe(false); // not enabled
    expect(isOurs({ flags: 3, server: 'corp:8080' })).toBe(false);
    expect(isOurs({ flags: 3, server: 'socks=10.0.0.5:1080' })).toBe(false);
  });

  it('a leftover of ours is saved as direct, so proxy off really turns it off', async () => {
    const f = fake(OURS); // our proxy left on, no backup (the wx1 state before the failing run)
    await setSystemProxy('127.0.0.1:1080');
    await clearSystemProxy();
    expect(f.now()).toEqual(DIRECT);
    expect(systemProxyActive()).toBe(false);
  });

  it('an old backup that holds our own proxy restores direct', () => {
    expect(savedState({ state: OURS, ours: OURS.server })).toEqual(DIRECT);
    expect(savedState({ proxyEnable: 1, proxyServer: 'socks=127.0.0.1:1080', ours: 'x' })).toEqual(DIRECT);
  });

  it('a session on another port still counts as ours at restore', async () => {
    const f = fake(DIRECT);
    await setSystemProxy('127.0.0.1:1080');
    f.change({ ...OURS, server: 'socks=127.0.0.1:1081' }); // a later session's proxy, same backup
    await clearSystemProxy();
    expect(systemProxyActive()).toBe(false);
    expect(f.now()).toEqual(DIRECT);
  });

  it("an explicit proxy off clears our proxy with no backup; app start does not touch it", async () => {
    const f = fake(OURS);
    await clearSystemProxy(); // app start / session end: no query, no change
    expect(f.now()).toEqual(OURS);
    await clearSystemProxy({ orphan: true });
    expect(f.now()).toEqual(DIRECT);
    const user = { flags: 3, server: 'corp:8080', bypass: '', pac: '' };
    const g = fake(user);
    await clearSystemProxy({ orphan: true }); // never someone else's proxy
    expect(g.now()).toEqual(user);
  });
});

// Q0351: the proxy turned off outside the app (Windows Settings) must not keep reading as ours.
describe('live proxy state (Q0351)', () => {
  it('ours while set; not ours once the user changed it outside the app; back when ours again', async () => {
    const user: ProxyState = { flags: 1, server: '', bypass: '', pac: '' };
    const g = fake(user);
    await setSystemProxy('127.0.0.1:1080');
    expect(await systemProxyLive()).toBe(true);
    g.change(DIRECT); // Windows Settings: proxy off
    expect(systemProxyActive()).toBe(true); // the backup file alone still says on
    expect(await systemProxyLive()).toBe(false);
    g.change(OURS);
    expect(await systemProxyLive()).toBe(true);
    await clearSystemProxy();
    expect(await systemProxyLive()).toBe(false);
  });
});
