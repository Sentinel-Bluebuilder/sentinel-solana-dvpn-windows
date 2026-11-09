// ─── The platform proof cannot leave anything out ───
import { describe, expect, it } from 'vitest';
import { CATALOGUE } from '../../src/cli/catalogue';
// @ts-expect-error plain ES module without types
import { PROTOCOLS, buildCells, requirement } from '../../scripts/lib/platform-cells.mjs';

const cells: { id: string; na?: boolean }[] = buildCells('.');
const ids = new Set(cells.map((c) => c.id));

describe('platform cells', () => {
  it('include every CLI command in the catalogue', () => {
    const missing = CATALOGUE.map((e) => `cli:${e.cmd}`).filter((id) => !ids.has(id));
    expect(missing).toEqual([]);
    expect(cells.filter((c) => c.id.startsWith('cli:')).length).toBe(CATALOGUE.length);
  });

  it('include every protocol-matrix row for all six protocols', () => {
    const rows = new Set(cells.filter((c) => c.id.startsWith('matrix:')).map((c) => c.id.split(':')[1]));
    expect(rows.size).toBeGreaterThanOrEqual(31);
    for (const r of rows) for (const p of PROTOCOLS) expect(ids.has(`matrix:${r}:${p}`)).toBe(true);
  });

  it('include every app control, setting, safety test and installer case', () => {
    expect(cells.filter((c) => c.id.startsWith('ui:')).length).toBeGreaterThan(150);
    expect(cells.filter((c) => c.id.startsWith('setting:')).length).toBeGreaterThan(20);
    for (const t of ['protocols', 'dns', 'killswitch', 'persist', 'armed', 'splitapps']) expect(ids.has(`safety:${t}`)).toBe(true);
    for (const i of ['I1', 'I5', 'I9', 'W2', 'W6']) expect(ids.has(`install:${i}`)).toBe(true);
  });

  it('require everything on both VMs except cells that cannot apply', () => {
    for (const c of cells) {
      for (const p of ['win11-x64', 'win11-arm64']) expect(requirement(c, p)).toBe(c.na ? 'n/a' : 'pass');
    }
  });

  it('never ask the laptop to turn the kill switch on, and never mark it done silently', () => {
    expect(requirement({ id: 'matrix:A11:wireguard' }, 'laptop-win11-home')).toBe('gated');
    expect(requirement({ id: 'safety:persist' }, 'laptop-win11-home')).toBe('gated');
    expect(requirement({ id: 'edge:udp-blocked:xray' }, 'laptop-win11-home')).toBe('vm-only');
    expect(requirement({ id: 'cli:wallet send' }, 'laptop-win11-home')).toBe('pass');
    expect(requirement({ id: 'matrix:A1:openvpn' }, 'laptop-win11-home')).toBe('pass');
  });
});

describe('evidence from a test log', async () => {
  // @ts-expect-error plain ES module without types
  const ev = await import('../../scripts/e2e/evidence-from-log.mjs');
  const log = [
    '﻿INFO  start',
    'PASS  version  (exit 0)',
    'FAIL  sandbox: wallet create  (exit 1)',
    'PASS    read back  (sub-check of the command above)',
    'PASS  start: internet works',
    'PASS  wireguard  connect     ok',
    'RED   xray       fulldevice  system traffic direct',
    'PASS  [cell:install:W6] x64 installer refused  (exit 3)',
  ].join('\r\n');
  const cmds = ['version', 'wallet create', 'wallet'];

  it('maps CLI checks by longest command prefix, sub-checks to the command above', () => {
    const { byCell, unmapped } = ev.mapChecks(ev.parseLog(log), { cli: true, cmds });
    expect(byCell.get('cli:version').result).toBe('PASS');
    expect(byCell.get('cli:wallet create').result).toBe('FAIL');
    expect(byCell.has('cli:wallet')).toBe(false);
    expect(unmapped.map((u: { name: string }) => u.name)).toEqual(['start: internet works']);
  });

  it('maps vm-matrix lines to matrix rows, RED = FAIL, and explicit [cell:] tags', () => {
    const { byCell } = ev.mapChecks(ev.parseLog(log), { cli: true, cmds });
    expect(byCell.get('matrix:A3:wireguard').result).toBe('PASS');
    expect(byCell.get('matrix:A7:xray').result).toBe('FAIL');
    expect(byCell.get('install:W6').result).toBe('PASS');
  });

  it('with --cells, one FAIL anywhere fails the whole-script cell', () => {
    const { byCell } = ev.mapChecks(ev.parseLog(log), { cells: ['safety:protocols'] });
    expect(byCell.get('safety:protocols').result).toBe('FAIL');
  });

  it('BLOCK lines become BLOCKED, and a FAIL in the same cell still wins', () => {
    const blockLog = [
      'BLOCK  [cell:phase2:ui-smoke-dark] ui-smoke dark  (setup held at permission: wallet has no SOL)',
      'BLOCK  [cell:phase2:ui-smoke-light] ui-smoke light  (no SOL)',
      'FAIL  [cell:phase2:ui-smoke-light] ui-smoke light renderer errors  (TypeError)',
    ].join('\n');
    const checks = ev.parseLog(blockLog);
    expect(checks[0].state).toBe('BLOCKED');
    const { byCell } = ev.mapChecks(checks, {});
    expect(byCell.get('phase2:ui-smoke-dark').result).toBe('BLOCKED');
    expect(byCell.get('phase2:ui-smoke-light').result).toBe('FAIL');
  });
});

describe('BUILD carry lines', () => {
  it('count carried builds except the named cells, and need a reason', async () => {
    // @ts-expect-error plain ES module without types
    const { parseBuildFile, buildCounts } = await import('../../scripts/lib/platform-cells.mjs');
    const b = parseBuildFile('117f6959-x64\ncarry 105811fd-x64 except=matrix:A25,cli:settle engine: dvpnd diff = usage audit only\n');
    expect(b.build).toBe('117f6959-x64');
    expect(b.carry[0].except).toEqual(['matrix:A25', 'cli:settle']);
    expect(buildCounts(b, '117f6959-x64', 'matrix:A25:wireguard')).toBe(true);
    expect(buildCounts(b, '105811fd-x64', 'matrix:A1:wireguard')).toBe(true);
    expect(buildCounts(b, '105811fd-x64', 'matrix:A25:wireguard')).toBe(false);
    expect(buildCounts(b, '105811fd-x64', 'cli:settle')).toBe(false);
    expect(buildCounts(b, '105811fd-x64', 'cli:settle run')).toBe(false);
    expect(buildCounts(b, '105811fd-x64', 'cli:settlement')).toBe(true);
    expect(buildCounts(b, '0000-x64', 'matrix:A1:wireguard')).toBe(false);
    expect(() => parseBuildFile('x\ncarry 1234\n')).toThrow(/reason/);
  });
});

describe('BUILD cover lines', () => {
  it('name the other platform and whole-segment cell prefixes, never the build line, and need a reason', async () => {
    // @ts-expect-error plain ES module without types
    const { parseBuildFile, coverFor } = await import('../../scripts/lib/platform-cells.mjs');
    const b = parseBuildFile('60364d4a-arm64\ncover win11-x64 cli,safety:dns,matrix:A14 same Go/JS code on both CPUs\n');
    expect(b.build).toBe('60364d4a-arm64');
    expect(b.cover[0]).toEqual({ platform: 'win11-x64', prefixes: ['cli', 'safety:dns', 'matrix:A14'], reason: 'same Go/JS code on both CPUs' });
    expect(coverFor(b, 'cli:wallet send')?.platform).toBe('win11-x64');
    expect(coverFor(b, 'safety:dns')?.platform).toBe('win11-x64');
    expect(coverFor(b, 'matrix:A14:xray')?.platform).toBe('win11-x64');
    expect(coverFor(b, 'safety:dnsleak')).toBeUndefined();
    expect(coverFor(b, 'matrix:A1:wireguard')).toBeUndefined();
    expect(parseBuildFile('cover win11-x64 cli reason\n').build).toBe('');
    expect(() => parseBuildFile('x\ncover win11-x64 cli\n')).toThrow(/reason/);
    expect(parseBuildFile('x\n').cover).toEqual([]);
  });
});
