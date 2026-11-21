// ─── platform-coverage — has every function been proven on every new platform? ───
// Builds the required cell list from the sources of truth (scripts/lib/platform-cells.mjs),
// reads the results the VM/laptop test scripts wrote, writes docs/PLATFORM-MATRIX.md and
// exits 1 while any required cell is missing, failed, or proven only on an older build.
//
// Evidence: evidence/<platform>/BUILD = the build under test (one line, e.g. "ddv18.3-app1a2b3c4-arm64"),
// and any number of evidence/<platform>/**/*.json files, each an array of
//   { "cell": "matrix:A1:wireguard", "result": "PASS" | "FAIL" | "BLOCKED",
//     "build": "<same id as BUILD>", "at": "2026-10-22T18:00:00Z", "test": "vm-matrix.ps1",
//     "vm": "ddv-w11a", "note": "exit IP = node 35.232.17.117" }
// The newest entry per cell (by `at`) on the current build decides the cell.
// BUILD may list more lines: `carry <build> [except=<cell prefix>,...] <reason>` = an earlier build whose results still
// count (the engine named the diff to the current build). Entries from carried builds count like
// the current build's; the newest per (cell, test) still wins, so a rerun on the current build
// replaces them, and the doc shows the build each cell was proven on.
// Usage: node scripts/platform-coverage.mjs [--platform win11-arm64] [--no-write]
//   --platform limits the exit check to one platform (the doc always shows all).
import fs from 'node:fs';
import path from 'node:path';
import { PLATFORMS, buildCells, buildCounts, coverFor, parseBuildFile, requirement } from './lib/platform-cells.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const args = process.argv.slice(2);
const only = args.includes('--platform') ? args[args.indexOf('--platform') + 1] : null;
const write = !args.includes('--no-write');
if (only && !PLATFORMS.some((p) => p.id === only)) throw new Error(`unknown platform ${only}`);

function jsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return jsonFiles(p);
    return e.name.endsWith('.json') ? [p] : [];
  });
}

/** platform -> { build, byCell: Map<cell, entry>, unknown: string[], bad: string[] } */
function loadEvidence(cellIds) {
  const out = {};
  for (const { id } of PLATFORMS) {
    const dir = path.join(ROOT, 'evidence', id);
    const buildFile = path.join(dir, 'BUILD');
    const parsed = parseBuildFile(fs.existsSync(buildFile) ? fs.readFileSync(buildFile, 'utf8') : '');
    const { build, carry } = parsed;
    const byCell = new Map();
    const old = new Map();
    const unknown = new Set();
    const bad = [];
    for (const f of jsonFiles(dir)) {
      let rows;
      try {
        rows = JSON.parse(fs.readFileSync(f, 'utf8'));
      } catch (e) {
        bad.push(`${path.relative(ROOT, f)}: ${e.message}`);
        continue;
      }
      for (const r of Array.isArray(rows) ? rows : [rows]) {
        if (!r?.cell || !['PASS', 'FAIL', 'BLOCKED'].includes(r.result) || !r.build || !r.at) {
          bad.push(`${path.relative(ROOT, f)}: entry needs cell, result PASS|FAIL|BLOCKED, build, at`);
          continue;
        }
        if (!cellIds.has(r.cell)) unknown.add(r.cell);
        // Newest entry per (cell, test): a later PASS from one test never hides another test's FAIL.
        const into = buildCounts(parsed, r.build, r.cell) ? byCell : old;
        if (!into.has(r.cell)) into.set(r.cell, new Map());
        const perTest = into.get(r.cell);
        const prev = perTest.get(r.test ?? '');
        if (!prev || prev.at < r.at) perTest.set(r.test ?? '', r);
      }
    }
    const fold = (m) => new Map([...m].map(([cell, perTest]) => {
      const rows = [...perTest.values()];
      const worst = rows.find((r) => r.result === 'FAIL') ?? rows.find((r) => r.result === 'BLOCKED') ?? rows[0];
      return [cell, worst];
    }));
    out[id] = { build, carry, parsed, byCell: fold(byCell), old: fold(old), unknown: [...unknown], bad };
  }
  return out;
}


/** One cell on one platform: { mark, ok } where ok = meets its requirement. */
function status(cell, platform, ev, all) {
  const need = requirement(cell, platform);
  if (need === 'n/a') return { mark: 'n/a', ok: true };
  if (need === 'vm-only') return { mark: 'VM only', ok: true };
  const r = ev.byCell.get(cell.id);
  if (need === 'gated' && !r) return { mark: 'owner-gated', ok: true };
  const on = r && r.build !== ev.build ? ` (${r.build})` : '';
  if (r?.result === 'PASS') return { mark: `PASS${on}`, ok: true };
  if (r) return { mark: `${r.result}${on}`, ok: false };
  // Same code on another platform: counts only while that cell PASSES on that platform's current build.
  const cov = coverFor(ev.parsed, cell.id);
  if (cov) {
    const other = all[cov.platform];
    const x = other?.byCell.get(cell.id);
    if (x?.result === 'PASS' && x.build === other.build) return { mark: `via ${cov.platform}`, ok: true };
    return { mark: `OPEN (cover: ${cov.platform} ${x ? x.result : 'not run'})`, ok: false };
  }
  const o = ev.old.get(cell.id);
  return { mark: o ? `OPEN (${o.result} on ${o.build})` : 'OPEN', ok: false };
}

const cells = buildCells(ROOT);
const ev = loadEvidence(new Set(cells.map((c) => c.id)));
const sum = Object.fromEntries(PLATFORMS.map((p) => [p.id, { pass: 0, via: 0, open: 0, fail: 0, other: 0 }]));
const sections = new Map();
for (const c of cells) {
  const row = PLATFORMS.map((p) => {
    const s = status(c, p.id, ev[p.id], ev);
    const k = s.mark.startsWith('PASS') ? 'pass' : s.mark.startsWith('via ') ? 'via' : s.mark.startsWith('OPEN') ? 'open' : s.ok ? 'other' : 'fail';
    sum[p.id][k]++;
    return s;
  });
  if (!sections.has(c.section)) sections.set(c.section, []);
  sections.get(c.section).push({ c, row });
}

const lines = [
  '# Platform matrix: every function on every new platform (generated)',
  '',
  'Generated by `node scripts/platform-coverage.mjs` from the sources of truth (CLI catalogue,',
  'UI control scan, SETTINGS-MAP, PROTOCOL-MATRIX section A, vm-safety-test.ps1) plus the',
  'release-test phases in `scripts/lib/platform-cells.mjs`. Do not edit by hand: results come from',
  '`evidence/<platform>/`. A cell counts on the build in `evidence/<platform>/BUILD` or on a build it carries (`carry <build> <reason>`, shown in brackets).',
  '**n/a** = cannot apply by design · **VM only** = never run on the owner\'s laptop ·',
  '**owner-gated** = kill switch on the laptop, paused by the owner (proven on both VMs instead) ·',
  '**via <platform>** = same code on both CPUs (a `cover` line in BUILD), counted only while that cell PASSES on the other platform\'s current build; never counted as PASS.',
  '',
  '| Platform | Build | PASS | via other CPU | OPEN | FAIL/BLOCKED | n/a, VM only, gated |',
  '|---|---|---|---|---|---|---|',
  ...PLATFORMS.map((p) => `| ${p.title} | ${ev[p.id].build || '-'}${ev[p.id].carry.length ? ` (carries ${ev[p.id].carry.map((c) => c.build).join(', ')})` : ''} | ${sum[p.id].pass} | ${sum[p.id].via} | ${sum[p.id].open} | ${sum[p.id].fail} | ${sum[p.id].other} |`),
  '',
];
for (const [name, rows] of sections) {
  lines.push(`## ${name}`, '', `| Cell | ${PLATFORMS.map((p) => p.title).join(' | ')} |`, `|---|${PLATFORMS.map(() => '---').join('|')}|`);
  for (const { c, row } of rows) lines.push(`| ${c.title.replace(/\|/g, '/')} | ${row.map((s) => s.mark).join(' | ')} |`);
  lines.push('');
}
if (write) fs.writeFileSync(path.join(ROOT, 'docs', 'PLATFORM-MATRIX.md'), `${lines.join('\n')}`);

for (const p of PLATFORMS) {
  const e = ev[p.id];
  console.log(`${p.id.padEnd(18)} build ${e.build || '(none)'}: ${sum[p.id].pass} PASS, ${sum[p.id].via} via other CPU, ${sum[p.id].open} OPEN, ${sum[p.id].fail} FAIL/BLOCKED`);
  for (const u of e.unknown) console.log(`  warning: evidence for unknown cell ${u}`);
  for (const b of e.bad) console.log(`  error: ${b}`);
}
const checked = only ? [only] : PLATFORMS.map((p) => p.id);
const failing = checked.filter((id) => sum[id].open + sum[id].fail > 0 || ev[id].bad.length > 0);
if (failing.length > 0) {
  console.log(`not proven yet: ${failing.join(', ')}`);
  process.exit(1);
}
console.log('every cell proven');
