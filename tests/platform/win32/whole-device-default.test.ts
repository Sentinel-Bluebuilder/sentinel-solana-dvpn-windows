// ─── V2Ray and Xray: whole computer is on by default (owner 2026-11-12) ───
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { wholeDeviceByDefault } from '../../../src/main/daemon/manager';

const mk = (root: string, files: Record<string, string>): void => {
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), text);
  }
};
const tun = (root: string, s: string): string => /tun = (true|false)/.exec(fs.readFileSync(path.join(root, s, 'config.toml'), 'utf8'))?.[1] ?? '';

describe('whole computer by default', () => {
  it('a fresh install turns it on for V2Ray and Xray', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ddv-wd-'));
    const staging = path.join(d, 'staging');
    const live = path.join(d, 'live');
    mk(staging, { 'v2ray/config.toml': 'tun = false\n', 'xray/config.toml': 'tun = false\n' });
    wholeDeviceByDefault(staging, live);
    expect(tun(staging, 'v2ray')).toBe('true');
    expect(tun(staging, 'xray')).toBe('true');
  });

  it('a reinstall keeps the choice the user made (negative control)', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ddv-wd-'));
    const staging = path.join(d, 'staging');
    const live = path.join(d, 'live');
    mk(staging, { 'v2ray/config.toml': 'tun = false\n' });
    mk(live, { 'v2ray/config.toml': 'tun = false\n' });
    wholeDeviceByDefault(staging, live);
    expect(tun(staging, 'v2ray')).toBe('false');
  });

  it('runs right after the settings carry in initDevice', () => {
    const src = fs.readFileSync('src/main/daemon/manager.ts', 'utf8');
    expect(src).toContain('carryLiveSettings(staging);\n        wholeDeviceByDefault(staging);');
  });
});
