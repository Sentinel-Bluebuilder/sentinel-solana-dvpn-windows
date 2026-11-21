// ─── Q0544: an empty service config is never read as "no settings" ───
// DVPN-LINUX hunt1: a spot preemption cut a root write in place; the copy stayed 0 bytes. `daemon settings` then
// showed one row, `daemon set --kill-switch on` said "Basis must be per_gb or per_hour.", and the Apply bars never
// finished. Windows reads config.toml itself: the same cut (power loss mid-apply) must give the same plain refusal.
import { afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvpn-q0544-'));
vi.mock('../../../src/main/daemon/manager', () => ({
  DAEMON_SERVICE: 'x', appUserAccount: () => 'u', binPath: () => 'x', DEFAULT_DAEMON_HOME: dir, daemonInfo: () => ({ reachable: true }),
  deviceRecord: () => ({ home: dir }), relinkDaemon: vi.fn(), scriptPath: () => 'x', startServiceIfStopped: async () => 'ok',
}));
vi.mock('../../../src/main/system/elevate', () => ({ runElevated: vi.fn(async () => { throw new Error('must not elevate'); }) }));
vi.mock('../../../src/main/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { getDaemonSettings, applyDaemonSettings, EMPTY_SETTINGS_COPY } = await import('../../../src/main/daemon/settings');
const { CONFIG_FILE } = await import('../../../src/core/daemon/layout');
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('an empty service config (Q0544)', () => {
  it('reads as empty and unreadable, never as a config with no settings', () => {
    fs.writeFileSync(path.join(dir, CONFIG_FILE), '  \n');
    const s = getDaemonSettings();
    expect(s.readable).toBe(false);
    expect(s.empty).toBe(true);
    expect(s.settings).toEqual({});
  });
  it('Apply refuses it with plain words before validating or elevating', async () => {
    fs.writeFileSync(path.join(dir, CONFIG_FILE), '');
    const r = await applyDaemonSettings({ killSwitch: 'on' } as never);
    expect(r).toEqual({ ok: false, error: EMPTY_SETTINGS_COPY });
    expect(r.error).not.toMatch(/Basis must be/);
  });
  it('negative control: a missing config is "missing", not "empty"', () => {
    fs.rmSync(path.join(dir, CONFIG_FILE), { force: true });
    const s = getDaemonSettings();
    expect(s.empty).toBeUndefined();
    expect(s.missing).toBe(true);
  });
  it('the CLI refuses `daemon set` and explains `daemon settings` with the same words', () => {
    const src = fs.readFileSync('src/cli/daemon-cmd.ts', 'utf8');
    expect(src).toContain('if (cur.empty) throw new Error(EMPTY_SETTINGS_COPY);');
    expect(src).toContain(': s.empty ? EMPTY_SETTINGS_COPY :');
  });
});
