// ─── `daemon migrate`: the installer's pre-cb33 -> cb33 home move (migrate-run.ts) ───
// Every system call is a fake: no service, key folder or binary is touched.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { patchToml, readToml } from '../../src/core/daemon/config';
import { runHomeMigration, type MigrateIo } from '../../src/main/daemon/migrate-run';

const fx = (n: string): string => readFileSync(join(__dirname, '..', 'fixtures', n), 'utf8');
const OLD = 'C:\\ProgramData\\dvpnd\\client';
const NEW = 'C:\\ProgramData\\sentinel-dvpn\\c0';
const KEY = '[1,2,3]';
const DVPND = 'C:\\app\\bin\\sentinel-dvpnd.exe';
const LEGACY = 'C:\\tmp\\legacy-dvpnd.exe';

function fakeIo(files: Record<string, string>, opts: { oldService?: boolean; initFails?: boolean } = {}) {
  const calls: string[] = [];
  const io: MigrateIo = {
    view: {
      exists: (p) => p in files || Object.keys(files).some((f) => f.startsWith(p + '\\')),
      read: (p) => (p in files ? files[p] : null),
    },
    mkdir: (d) => { calls.push(`mkdir ${d}`); },
    copyFile: (a, b) => { calls.push(`copy ${a} -> ${b}`); files[b] = files[a]; },
    writeFile: (f, t) => { calls.push(`write ${f}`); files[f] = t; },
    exists: (f) => f === LEGACY || f in files,
    run: async (exe, args) => {
      calls.push(`run ${exe} ${args.join(' ')}`);
      if (exe === 'sc.exe' && args[0] === 'query') return { code: opts.oldService === false ? 1060 : 0, out: opts.oldService === false ? '[SC] EnumQueryServicesStatus:OpenService FAILED 1060' : 'STATE : 1 STOPPED' };
      if (exe === DVPND && args[0] === 'init') {
        if (opts.initFails) return { code: 1, out: 'boom' };
        files[`${NEW}\\config.toml`] = fx('cb33-c0-config.toml');
        files[`${NEW}\\xray\\config.toml`] = 'tun = false\n';
      }
      return { code: 0, out: '' };
    },
  };
  return { io, calls, files };
}

function oldHome(): Record<string, string> {
  let client = fx('dvpnd-client.v2.config.toml');
  client = patchToml(client, 'network', 'kill_switch', 'on');
  client = patchToml(client, 'network', 'allow_lan', true);
  return {
    [`${OLD}\\config.toml`]: fx('dvpnd-root.v2.config.toml'),
    [`${OLD}\\client\\config.toml`]: client,
    [`${OLD}\\client\\keys\\device.json`]: KEY,
    [`${OLD}\\client\\xray\\config.toml`]: 'tun = true\n',
  };
}

describe('runHomeMigration', () => {
  it('old service out with the OLD binary first, then key, init, settings, whole-device mode', async () => {
    const { io, calls, files } = fakeIo(oldHome());
    const r = await runHomeMigration({ dvpnd: DVPND, legacyDvpnd: LEGACY }, io);
    expect(r.status).toBe('migrated');
    const order = calls.filter((c) => !c.startsWith('mkdir'));
    expect(order[0]).toBe('run sc.exe query dvpnd');
    expect(order[1]).toBe(`run ${LEGACY} service uninstall`);
    expect(order[2]).toBe(`copy ${OLD}\\client\\keys\\device.json -> ${NEW}\\keys\\operator.json`);
    expect(order[3]).toBe(`run ${DVPND} init --instance c0 --home ${NEW} --owner CWT5iHdi76j2wGkfWcs8NXAUyPwJ44A7ZGAdGoYFRaf9 --plain-key`);
    const cfg = files[`${NEW}\\config.toml`];
    expect(readToml(cfg, 'network', 'kill_switch')).toBe('persist');
    expect(readToml(cfg, 'network', 'allow_lan')).toBe(true);
    expect(readToml(files[`${NEW}\\xray\\config.toml`], '', 'tun')).toBe(true);
    expect(files[`${NEW}\\keys\\operator.json`]).toBe(KEY);
  });

  it('without the old binary the old service is deleted with sc.exe and the log says so', async () => {
    const { io, calls } = fakeIo(oldHome());
    const r = await runHomeMigration({ dvpnd: DVPND, legacyDvpnd: 'C:\\missing.exe' }, io);
    expect(r.status).toBe('migrated');
    expect(calls).toContain('run sc.exe delete dvpnd');
    expect(r.status === 'migrated' && r.log.join('\n')).toMatch(/no old binary/);
  });

  it('a failed init stops the move and names the step; nothing after it runs', async () => {
    const { io, calls } = fakeIo(oldHome(), { initFails: true });
    const r = await runHomeMigration({ dvpnd: DVPND, legacyDvpnd: LEGACY }, io);
    expect(r).toMatchObject({ status: 'failed', step: 'init' });
    expect(calls.some((c) => c.startsWith(`write ${NEW}`))).toBe(false);
  });

  it('skips a fresh install, and a home already moved', async () => {
    expect(await runHomeMigration({ dvpnd: DVPND }, fakeIo({}).io)).toEqual({ status: 'skipped', reason: 'no-old-home' });
    const moved = { ...oldHome(), [`${NEW}\\config.toml`]: fx('cb33-c0-config.toml') };
    expect(await runHomeMigration({ dvpnd: DVPND }, fakeIo(moved).io)).toEqual({ status: 'skipped', reason: 'already-migrated' });
  });
});
