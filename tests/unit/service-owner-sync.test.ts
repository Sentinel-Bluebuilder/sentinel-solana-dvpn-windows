// ─── rc9-c OWNER-SYNC (Windows testing w11 live): same device key, another wallet: the service is pointed at the wallet ───
// Service c0 for wallet A; wallet B adopted its key (E-ST) and granted it; config.toml kept owner = A, dvpnd crash-looped.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const A = '6uggG5asAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1';
const B = 'FFKR8amDBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1';
const st = vi.hoisted(() => ({ record: null as null | { device: string; home: string; owner: string; at: number }, svcOwner: null as string | null, installs: 0 }));
vi.mock('../../src/main/wallet/vault', async (orig) => ({ ...(await orig<object>()), ownerAddress: () => 'FFKR8amDBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1' }));
vi.mock('../../src/main/daemon/manager', async (orig) => ({
  ...(await orig<object>()),
  deviceRecord: () => st.record,
  serviceOwner: () => st.svcOwner,
  installService: async () => { st.installs += 1; return { ok: true, data: { relogin: false } }; },
}));

const { setHost } = await import('../../src/main/host');
setHost({ name: 'cli', resourcesDir: '', dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'own-')), keyStore: {} as never, emit: () => undefined });
const { COMMANDS } = await import('../../src/cli/commands');
const { parseArgs } = await import('../../src/cli/args');
const real = await vi.importActual<typeof import('../../src/main/daemon/manager')>('../../src/main/daemon/manager');

type Line = { human: string; data: Record<string, unknown> };
async function run(line: string): Promise<Line[]> {
  const out: Line[] = [];
  try {
    await COMMANDS.device.run(parseArgs(line.split(' ')), { json: true, print: (human: string, data?: unknown) => { out.push({ human, data: (data ?? {}) as Record<string, unknown> }); } } as never);
  } catch (e) {
    if (!(out[0]?.data.needsConfirm)) throw e; // confirm() prints the preview, then stops the command
  }
  return out;
}
beforeEach(() => { st.record = { device: 'Dev1', home: 'C:\\ProgramData\\sentinel-dvpn\\c0', owner: B, at: 1 }; st.svcOwner = A; st.installs = 0; });

describe('device switch: same device key, the service still runs for the old wallet', () => {
  it('re-points the service (one install), switched:true, never "nothing to switch"', async () => {
    const out = await run('device switch --yes');
    expect(st.installs).toBe(1);
    expect(out[0].data).toMatchObject({ switched: true, from: A, owner: B, sameDevice: true });
  });
  it('without --yes: a preview naming both wallets; nothing is installed', async () => {
    const out = await run('device switch');
    expect(st.installs).toBe(0);
    expect(out[0].data).toMatchObject({ needsConfirm: true, serviceOwner: A, owner: B });
  });
  it('negative control: the service already runs for this wallet: nothing to switch', async () => {
    st.svcOwner = B;
    const out = await run('device switch --yes');
    expect(st.installs).toBe(0);
    expect(out[0].data).toMatchObject({ switched: false, owner: B });
  });
});

describe('serviceOwner / setupDaemonArgs', () => {
  it('reads the root owner of an installed config.toml; no file = null', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'c0-'));
    expect(real.serviceOwner(home)).toBeNull();
    fs.writeFileSync(path.join(home, 'config.toml'), fs.readFileSync(path.resolve('tests/fixtures/cb33-c0-config.toml'), 'utf8'));
    expect(real.serviceOwner(home)).toBe('11111111111111111111111111111111');
  });
  it('setup-daemon.ps1 gets Owner = the device record wallet', () => {
    expect(real.setupDaemonArgs({ device: 'Dev1', home: 'C:\\ProgramData\\sentinel-dvpn\\c0', owner: B, at: 1 } as never, 'C:\\stage')).toMatchObject({ Owner: B, Staging: 'C:\\stage', DaemonHome: 'C:\\ProgramData\\sentinel-dvpn\\c0' });
  });
});

describe('setup-daemon.ps1 OWNER-SYNC (static; the Pester case runs it on Windows)', () => {
  const ps = fs.readFileSync(path.resolve('resources/scripts/setup-daemon.ps1'), 'utf8');
  const lit = /\$OwnerLine = '((?:[^']|'')*)'/.exec(ps)?.[1].replace(/''/g, "'") ?? '';
  const re = new RegExp(lit.replace(/^\(\?m\)/, ''), 'm');
  it('takes -Owner, checks it is a wallet address, and rewrites only when it differs', () => {
    expect(ps).toMatch(/\[string\]\$Owner = ''/);
    expect(ps).toMatch(/\$Owner -notmatch '\^\[1-9A-HJ-NP-Za-km-z\]\{32,44\}\$'/);
    expect(ps.indexOf('function Update-ConfigOwner')).toBeLessThan(ps.indexOf("if ($MyInvocation.InvocationName -eq '.') { return }"));
    expect(ps.indexOf('Update-ConfigOwner ([System.IO.File]::ReadAllText($cfgPath)) $Owner')).toBeGreaterThan(ps.indexOf("Copy-Item -Path (Join-Path $snap '*')"));
  });
  it('its owner pattern finds the root owner of the real config fixtures (either quote), and only it', () => {
    expect(lit.startsWith('(?m)')).toBe(true);
    for (const f of ['cb33-c0-config.toml', 'dvpnd-client.config.toml', 'dvpnd-client.v2.config.toml']) {
      const text = fs.readFileSync(path.resolve('tests/fixtures', f), 'utf8');
      const head = text.slice(0, /^\s*\[/m.exec(text)?.index ?? text.length);
      const m = re.exec(head);
      expect(m?.[3], f).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    }
    expect(re.exec("[client]\nowner = 'X'\n".slice(0, 0))).toBeNull(); // nothing before the first [section]: no match
  });
});
