// ─── Q0507: a fresh install does not arm the kill switch (release blocker) ───
// dvpnd init writes kill_switch = 'on' and the 11-07 migration turns 'on' into 'persist', so every fresh install
// ran "Always": install, connect, reboot = offline (DVPN-WIN hunt VM 2026-11-12). F14.1 / NETWORK-SAFETY row 2:
// a fresh install stages 'off'; an existing home keeps the user's value (a carried 'on' still becomes persist).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { carryLiveSettings, killSwitchOffOnFreshInstall } from '../../../src/main/daemon/manager';
import { readToml } from '../../../src/core/daemon/config';

const INIT = '[network]\nkill_switch = "on"\nallow_lan = false\n';   // what dvpnd init writes

const setup = (live: string | null): { staging: string; live: string } => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ddv-ks-'));
  const staging = path.join(d, 'staging');
  const home = path.join(d, 'live');
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, 'config.toml'), INIT);
  if (live !== null) {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'config.toml'), live);
  }
  return { staging, live: home };
};
const ks = (staging: string): unknown => readToml(fs.readFileSync(path.join(staging, 'config.toml'), 'utf8'), 'network', 'kill_switch');
// initDevice's order: carry the installed settings, then the fresh-install default.
const init = (s: { staging: string; live: string }): void => {
  carryLiveSettings(s.staging, s.live);
  killSwitchOffOnFreshInstall(s.staging, s.live);
};

describe('Q0507 kill switch default', () => {
  it('a fresh install (no installed home) stages off', () => {
    const s = setup(null);
    init(s);
    expect(ks(s.staging)).toBe('off');
    expect(fs.readFileSync(path.join(s.staging, 'config.toml'), 'utf8')).toContain('allow_lan = false'); // nothing else touched
  });

  it("an update over a home set to 'on' keeps the user's choice as persist", () => {
    const s = setup('[network]\nkill_switch = "on"\n');
    init(s);
    expect(ks(s.staging)).toBe('persist');
  });

  it("an update over a home set to 'persist' keeps persist", () => {
    const s = setup('[network]\nkill_switch = "persist"\n');
    init(s);
    expect(ks(s.staging)).toBe('persist');
  });

  it("an update over a home set to 'off' stays off", () => {
    const s = setup('[network]\nkill_switch = "off"\n');
    init(s);
    expect(ks(s.staging)).toBe('off');
  });

  it('a pre-cb33 home (client/config.toml only) counts as installed, not fresh', () => {
    const s = setup(null);
    fs.mkdirSync(path.join(s.live, 'client'), { recursive: true });
    fs.writeFileSync(path.join(s.live, 'client', 'config.toml'), '[network]\nkill_switch = "persist"\n');
    killSwitchOffOnFreshInstall(s.staging, s.live);
    expect(ks(s.staging)).toBe('on'); // left for the carry/migration path
  });

  it('initDevice applies it after the settings carry', () => {
    const src = fs.readFileSync('src/main/daemon/manager.ts', 'utf8');
    expect(src).toContain('carryLiveSettings(staging);\n        wholeDeviceByDefault(staging);\n        killSwitchOffOnFreshInstall(staging);');
  });
});
