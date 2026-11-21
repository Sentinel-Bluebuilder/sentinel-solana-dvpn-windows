// ─── rc9-c DVPND-BIN (macOS testing C3): an installed app never takes DVPND_BIN for the binary it installs as a service ───
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A resources folder laid out as an install (<install>/resources/{app.asar, resources/bin}) or as a dev tree. */
function layout(packaged: boolean): { res: string; own: string; mine: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dvb-'));
  const res = packaged ? path.join(root, 'resources', 'resources') : path.join(root, 'resources');
  fs.mkdirSync(path.join(res, 'bin'), { recursive: true });
  if (packaged) fs.writeFileSync(path.join(root, 'resources', 'app.asar'), 'asar');
  const mine = path.join(root, 'my-dvpnd.exe');
  fs.writeFileSync(mine, 'x');
  return { res, own: '', mine };
}

const { setHost } = await import('../../src/main/host');
const host = (res: string): void => setHost({ name: 'cli', resourcesDir: res, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'dvbd-')), keyStore: {} as never, emit: () => undefined });
const m = await import('../../src/main/daemon/manager');

describe('dvpndPath and DVPND_BIN', () => {
  it('installed app + DVPND_BIN set: the bundled binary, never the variable', () => {
    const l = layout(true);
    host(l.res);
    expect(m.isPackagedResources()).toBe(true);
    const p = m.dvpndPath({ DVPND_BIN: l.mine });
    expect(p).not.toBe(l.mine);
    expect(p.startsWith(path.join(l.res, 'bin'))).toBe(true);
  });
  it('dev tree + DVPND_BIN set: the variable is honoured', () => {
    const l = layout(false);
    host(l.res);
    expect(m.isPackagedResources()).toBe(false);
    expect(m.dvpndPath({ DVPND_BIN: l.mine })).toBe(l.mine);
  });
  it('dev tree + DVPND_BIN naming a missing file: the bundled binary', () => {
    const l = layout(false);
    host(l.res);
    expect(m.dvpndPath({ DVPND_BIN: path.join(l.res, 'nope.exe') }).startsWith(path.join(l.res, 'bin'))).toBe(true);
  });
});
