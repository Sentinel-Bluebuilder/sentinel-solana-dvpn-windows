// ─── release-win — one command from a clean checkout to verified Windows installers ───
// 1. typecheck, unit tests          (a release never ships red)
// 2. build the app and the CLI      (JavaScript: the same for every CPU type)
// 3. per arch: fetch + verify every bundled dependency (build/deps.lock.json) into
//    build/stage/<arch>, then electron-builder → dist/Devnet-dVPN-Setup-<version>-<arch>.exe
// 4. dist/SHA256SUMS.txt for everything users download
// Usage: node scripts/release-win.mjs [--arch x64|arm64|all] [--offline] [--skip-tests]
//   default --arch all = both installers. arm64 needs build/arm64/{dvpnd,pipe-bridge}.exe
//   (docs/INSTALLER.md → ARM64).
import { createHash } from 'node:crypto';
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ARCHES, checkArch } from './lib/deps-arch.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const args = process.argv.slice(2);
const offline = args.includes('--offline');
const skipTests = args.includes('--skip-tests');
const archAt = args.indexOf('--arch');
const archArg = archAt >= 0 ? args[archAt + 1] : 'all';
const arches = archArg === 'all' ? ARCHES : [checkArch(archArg)];

function step(title, cmd) {
  const t = Date.now();
  console.log(`\n─── ${title} ───\n$ ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
  console.log(`ok (${((Date.now() - t) / 1000).toFixed(1)} s)`);
}

if (process.platform !== 'win32') throw new Error('release-win runs on Windows (NSIS + signing tools)');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

step('release version (L3)', 'node scripts/check-release-version.mjs' + (args.includes('--allow-same-version') ? ' --allow-same-version' : ''));
step('typecheck', 'npm run typecheck');
if (skipTests) console.log('\n─── unit tests SKIPPED (--skip-tests) ───');
else step('unit tests', 'npm test');
step('app build', 'npm run build');
step('CLI build', 'npm run build:cli');
if (!process.env.CSC_LINK && !process.env.WIN_CSC_LINK) {
  console.log('\nnote: no CSC_LINK set → the installers are UNSIGNED (SmartScreen will say "Unknown publisher")');
}
const dist = path.join(ROOT, 'dist');

// A shipped RPC endpoint must never carry an inline api-key. The installer writes no key (the default is the
// public devnet RPC, src/core/chain/rpc.ts DEFAULT_RPC_URLS); our test rigs inject their lane URL only at setup
// time. Fail the build if a key ever leaks into the packaged payload — the unpacked dir holds the asar, the
// bundled daemon/protocol exes and the WireGuard/AmneziaWG/OpenVPN MSIs, so -a scans those binaries as text too.
// Mirrors scripts/release-mac.mjs scanSecrets (QA, which scans the .app bundle). (DIR 11-08)
function scanSecrets(arch) {
  const unpacked = path.join(dist, arch === 'x64' ? 'win-unpacked' : 'win-arm64-unpacked');
  if (!fs.existsSync(unpacked)) throw new Error(`secret scan: ${arch} payload ${path.relative(ROOT, unpacked)} not found (nothing scanned — refusing to pass)`);
  let out = '';
  try {
    out = execFileSync('grep', ['-rIaE', 'api[_-]?key[=:]', unpacked], { encoding: 'utf8' });
  } catch (e) {
    if (e.status === 1) { console.log(`ok   ${arch} installer payload carries no inline api-key`); return; }
    throw e;
  }
  const redacted = out.replace(/(api[_-]?key[=:])[^"'\s&]+/gi, '$1<REDACTED>').split('\n').slice(0, 10).join('\n');
  throw new Error(`SECRET LEAK: inline api-key in the ${arch} installer payload (the installer must ship no RPC key):\n${redacted}`);
}

const setups = [];
for (const arch of arches) {
  step(`dependencies (${arch})`, `node scripts/fetch-deps.mjs --arch ${arch} --release${offline ? ' --offline' : ''}`);
  step(`installer (${arch})`, `npx electron-builder --win nsis --${arch} --publish never`);
  const setup = `Devnet-dVPN-Setup-${pkg.version}-${arch}.exe`;
  if (!fs.existsSync(path.join(dist, setup))) throw new Error(`expected ${setup} in dist/`);
  console.log(`\n─── secret scan (${arch}) ───`);
  scanSecrets(arch);
  setups.push(setup);
}

const files = fs.readdirSync(dist).filter((f) => /^Devnet-dVPN-Setup-.*\.(exe|blockmap)$/i.test(f));
const sums = files.map((f) => `${createHash('sha256').update(fs.readFileSync(path.join(dist, f))).digest('hex')}  ${f}`);
fs.writeFileSync(path.join(dist, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
for (const s of setups) console.log(`release ready: dist/${s} (${(fs.statSync(path.join(dist, s)).size / 1048576).toFixed(1)} MB)`);
console.log(sums.join('\n'));
