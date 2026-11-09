// ─── fetch-deps — every third-party program the installer ships, pinned ───
// Reads build/deps.lock.json. For each dependency: download into build/.deps-cache
// (or reuse a cached copy), refuse on any SHA-256 mismatch, then:
//   msi → resources/deps/<file>.msi   (installed by resources/scripts/install-deps.ps1)
//   exe → its `dest`                  (protocol binaries the service finds on its PATH)
//   zip → only the listed `files` into `dest`
// Also checks the locally built binaries exist and writes THIRD-PARTY-NOTICES.txt.
//
// Per arch (the installer is built once per arch, electron-builder.yml takes
// build/stage/${arch}/resources):
//   --arch x64   (default) fills the dev tree resources/ as before, then mirrors it to build/stage/x64
//   --arch arm64 fills build/stage/arm64/resources: our scripts + arm64 downloads + build/arm64/*.exe
// Every staged .exe/.dll must carry the PE machine of its arch, or the run fails.
// Usage: node scripts/fetch-deps.mjs [--arch x64|arm64] [--offline]   (offline = cache only)
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ARCHES, PE_MACHINE, checkArch, localSource, lockProblems, peMachine, resolveDep } from './lib/deps-arch.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const LOCK = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'deps.lock.json'), 'utf8'));
const CACHE = path.join(ROOT, 'build', '.deps-cache');
const argv = process.argv.slice(2);
const offline = argv.includes('--offline');
const release = argv.includes('--release');
const archAt = argv.indexOf('--arch');
const ARCH = checkArch(archAt >= 0 ? argv[archAt + 1] : 'x64');
// x64 keeps writing the dev tree (npm run dev, VM asar builds); arm64 never touches it.
const OUT_ROOT = ARCH === 'x64' ? ROOT : path.join(ROOT, 'build', 'stage', ARCH);
const STAGE = path.join(ROOT, 'build', 'stage', ARCH, 'resources');
const DEPS_OUT = path.join(OUT_ROOT, 'resources', 'deps');

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
/** Copy unless the destination already has the same bytes (a running tunnel locks its exe). */
function copyIfChanged(src, dst) {
  if (fs.existsSync(dst) && sha256(dst) === sha256(src)) return;
  fs.copyFileSync(src, dst);
}

async function download(url, to) {
  if (offline) throw new Error(`offline and not cached: ${url}`);
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'devnet-dvpn-build' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  fs.writeFileSync(`${to}.part`, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(`${to}.part`, to);
}

async function cached(dep) {
  const file = path.join(CACHE, path.basename(new URL(dep.url).pathname));
  if (!fs.existsSync(file) || sha256(file) !== dep.sha256) await download(dep.url, file);
  const got = sha256(file);
  if (got !== dep.sha256) {
    fs.rmSync(file, { force: true });
    throw new Error(`${dep.name}: SHA-256 mismatch (want ${dep.sha256}, got ${got})`);
  }
  return file;
}

function extractZip(zip, dest, files) {
  const tmp = fs.mkdtempSync(path.join(CACHE, 'unzip-'));
  try {
    // Windows' own bsdtar (Windows 10+) reads zip; Git Bash's GNU tar would take "C:" for a host.
    // Elsewhere (a Linux build box) GNU tar can't read zip at all ("does not look like a tar
    // archive", windows-arm on a Linux build host): use unzip there.
    if (process.platform === 'win32') {
      execFileSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', tmp], { stdio: 'inherit' });
    } else {
      execFileSync('unzip', ['-q', '-o', zip, '-d', tmp], { stdio: 'inherit' });
    }
    fs.mkdirSync(dest, { recursive: true });
    for (const f of files) {
      const src = path.join(tmp, f);
      if (!fs.existsSync(src)) throw new Error(`${path.basename(zip)} has no ${f}`);
      // Flattened: a nested entry (wintun/bin/arm64/wintun.dll) lands next to the program that loads it.
      // LICENSE.txt files get the dep's name so two zips never overwrite each other's notice.
      const base = path.basename(f);
      copyIfChanged(src, path.join(dest, base === 'LICENSE.txt' ? `${path.basename(path.dirname(f)) || 'dep'}-LICENSE.txt` : base));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Every .exe/.dll under dir, recursively. */
function peFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return peFiles(p);
    return /\.(exe|dll)$/i.test(e.name) ? [p] : [];
  });
}

const problems = lockProblems(LOCK);
if (problems.length > 0) throw new Error(`deps.lock.json:\n  ${problems.join('\n  ')}`);

fs.mkdirSync(CACHE, { recursive: true });
if (ARCH !== 'x64') {
  // Fresh stage: our own scripts + proto from the dev tree, never its x64 bin/ or deps/.
  fs.rmSync(path.join(ROOT, 'build', 'stage', ARCH), { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'resources'), STAGE, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(path.join(ROOT, 'resources'), src).split(path.sep)[0];
      return rel !== 'bin' && rel !== 'deps';
    },
  });
}
fs.mkdirSync(DEPS_OUT, { recursive: true });
const manifest = [];
for (const raw of LOCK.deps) {
  const dep = resolveDep(raw, ARCH);
  const file = await cached(dep);
  if (dep.kind === 'msi') {
    const out = path.join(DEPS_OUT, path.basename(file));
    copyIfChanged(file, out);
    manifest.push({ name: dep.name, version: dep.version, file: path.basename(file), sha256: dep.sha256, signer: dep.signer, arch: ARCH });
  } else if (dep.kind === 'exe') {
    const out = path.join(OUT_ROOT, dep.dest);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    copyIfChanged(file, out);
  } else if (dep.kind === 'zip') {
    extractZip(file, path.join(OUT_ROOT, dep.dest), dep.files);
  } else {
    throw new Error(`${dep.name}: unknown kind ${dep.kind}`);
  }
  console.log(`ok   ${dep.name} ${dep.version} (${ARCH})`);
}
// The install script checks each MSI against this list (hash + signer + arch) before running it.
fs.writeFileSync(path.join(DEPS_OUT, 'deps.json'), `${JSON.stringify(manifest, null, 2)}\n`);

for (const l of LOCK.local) {
  const src = path.join(ROOT, localSource(l, ARCH));
  if (!fs.existsSync(src)) throw new Error(`missing local binary ${localSource(l, ARCH)} (${l.note})`);
  // A pinned local binary (the daemon, its CLI) must be the reproducible build named in the lock.
  const want = ARCH === 'arm64' ? l.arm64?.sha256 : l.sha256;
  if (want && sha256(src) !== want) throw new Error(`${l.name} (${ARCH}): ${localSource(l, ARCH)} is not the pinned build (want ${want}, got ${sha256(src)})`);
  const dst = path.join(OUT_ROOT, l.path);
  if (dst !== src) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    copyIfChanged(src, dst);
  }
  console.log(`ok   ${l.name} (local ${ARCH}, ${sha256(src).slice(0, 12)}…)`);
}

if (ARCH === 'x64') {
  fs.rmSync(path.join(ROOT, 'build', 'stage', 'x64'), { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'resources'), STAGE, { recursive: true });
}

// An x64 program in the ARM64 installer would run emulated at best and its driver never loads.
const want = PE_MACHINE[ARCH];
const wrong = peFiles(STAGE).filter((f) => peMachine(fs.readFileSync(f)) !== want);
if (wrong.length > 0) {
  throw new Error(`wrong CPU type for ${ARCH} (want 0x${want.toString(16)}):\n  ${wrong.map((f) => path.relative(ROOT, f)).join('\n  ')}`);
}
console.log(`ok   ${peFiles(STAGE).length} programs in build/stage/${ARCH} are ${ARCH}`);

// One component's stanza. `shas` adds the per-arch download hashes (only the deps fetch-deps downloads have them).
const entry = (d, shas) => [
  `${d.title}${d.version ? ` ${d.version}` : ''}`,
  `  License: ${d.license}${d.licenseUrl ? ` (${d.licenseUrl})` : ''}`,
  `  Source:  ${d.sourceUrl}`,
  ...(shas ? ARCHES.map((a) => `  SHA-256 (${a}): ${resolveDep(d, a).sha256}`) : []),
  '',
];
// A component's full license text, read from the copy fetch-deps just placed beside it (the authoritative copy),
// reproduced here so the installer's license page carries it too. Missing file → the link in the stanza stands alone.
const embeddedText = (label, ...candidates) => {
  const file = candidates.find((c) => fs.existsSync(c));
  if (!file) return [];
  const text = fs.readFileSync(file, 'utf8').trim();
  return text ? ['', `----- ${label} (full text) -----`, '', text, ''] : [];
};
const wintunLicense = embeddedText(
  'Wintun license',
  path.join(OUT_ROOT, 'resources', 'bin', 'xray', 'wintun-LICENSE.txt'),
  path.join(ROOT, 'resources', 'bin', 'xray', 'wintun-LICENSE.txt'),
);
const sqliteWasmLicense = embeddedText(
  'go-sqlite3-wasm (MIT-0) license - compiled into sentinel-dvpnd',
  path.join(OUT_ROOT, 'resources', 'bin', 'go-sqlite3-wasm-LICENSE.txt'),
  path.join(ROOT, 'resources', 'bin', 'go-sqlite3-wasm-LICENSE.txt'),
);

const notices = [
  'Devnet dVPN bundles the following third-party software, unmodified.',
  'Each is distributed under its own license; the full license text ships beside each component in the',
  'install directory, and the notable full texts are reproduced at the end of this file.',
  'Source code is available at the Source links below.',
  '',
  '== Downloaded at build time (verified by SHA-256) ==',
  '',
  ...LOCK.deps.flatMap((d) => entry(d, true)),
  '== Built from source and bundled ==',
  '',
  ...(LOCK.local || []).filter((d) => d.license).flatMap((d) => entry(d, false)),
  ...(LOCK.builtInto || []).flatMap((d) => entry(d, false)),
  '== Shipped inside the application ==',
  '',
  ...(LOCK.bundled || []).flatMap((d) => entry(d, false)),
];
if (LOCK.gpl && LOCK.gpl.writtenOffer) notices.push('== Written offer for GPL components ==', '', LOCK.gpl.writtenOffer, '');
notices.push(...wintunLicense, ...sqliteWasmLicense);
fs.writeFileSync(path.join(ROOT, 'build', 'THIRD-PARTY-NOTICES.txt'), notices.join('\r\n'));
console.log('ok   build/THIRD-PARTY-NOTICES.txt');

// The installer's license page: our license, then every bundled component's.
const own = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8').replace(/\r?\n/g, '\r\n');
const page = ['Devnet dVPN', '', own, '', '-'.repeat(72), '', ...notices].join('\r\n');
fs.writeFileSync(path.join(ROOT, 'build', 'license.txt'), page);
console.log('ok   build/license.txt');

// ─── GPL corresponding-source gate (release only: node scripts/fetch-deps.mjs --release) ───
// A GPL component must ship with an offer of corresponding source (in the notices above). At release we also PROVE
// that source is fetchable and byte-correct, so the offer can actually be honoured: every GPL dep must declare
// sourceTarballs, and each is downloaded and SHA-256-verified (cached() refuses a mismatch). A GPL dep with no
// sourceTarballs, or any tarball missing / re-rolled, FAILS the release rather than shipping a binary we can't
// back with source.
if (release) {
  for (const d of LOCK.deps) {
    const isGpl = /GPL/i.test(d.license || '');
    const tarballs = d.sourceTarballs || [];
    if (isGpl && tarballs.length === 0) {
      throw new Error(`release: ${d.name} is ${d.license} but declares no sourceTarballs — GPL needs corresponding source`);
    }
    for (const t of tarballs) {
      const file = await cached({ name: `${d.name}-source`, url: t.url, sha256: t.sha256 });
      console.log(`ok   corresponding source verified: ${d.name} <- ${path.basename(file)} (${t.what})`);
    }
  }
  console.log('ok   GPL corresponding-source gate passed');
}
