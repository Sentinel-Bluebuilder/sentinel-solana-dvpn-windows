// ─── electron-builder afterPack: no build leftovers for other systems in the installer (the agent tools rc.9, Windows testing) ───
// The rc.8 Windows installer carried ~6.2 MB that can never run on Windows: bigint-buffer/build/node_gyp_bins/python3
// (a Linux ELF) and bufferutil / utf-8-validate prebuilds for darwin, linux and win32-ia32. Here, after the app is
// packed and before the installer is made: every node_gyp_bins folder goes, every prebuilds/ keeps only this
// platform-arch, then every file is read: an ELF or Mach-O binary fails the build. A PE for another CPU is only
// logged (NSIS and driver installers in the payload are 32-bit PE by design).
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** electron-builder's Arch enum → the prebuilds folder suffix. */
const ARCH = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };
const PE_MACHINE = { x64: 0x8664, arm64: 0xaa64, ia32: 0x14c };

/** 'elf' | 'macho' | 'pe' (with its machine) | null for a file that is no executable binary. Pure. */
function binaryKind(buf) {
  if (buf.length >= 4 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) return { kind: 'elf' };
  if (buf.length >= 4) {
    const m = buf.readUInt32BE(0);
    if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(m)) return { kind: 'macho' };
  }
  if (buf.length >= 0x40 && buf[0] === 0x4d && buf[1] === 0x5a) {
    const off = buf.readUInt32LE(0x3c);
    if (off + 6 <= buf.length && buf.readUInt32BE(off) === 0x50450000) return { kind: 'pe', machine: buf.readUInt16LE(off + 4) };
    return { kind: 'pe', machine: null };
  }
  return null;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/** Removes node_gyp_bins folders and other-platform prebuilds under root. Returns the removed paths. */
function prune(root, keep) {
  const removed = [];
  const visit = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = path.join(dir, e.name);
      if (e.name === 'node_gyp_bins') { fs.rmSync(p, { recursive: true, force: true }); removed.push(p); continue; }
      if (e.name === 'prebuilds') {
        for (const k of fs.readdirSync(p, { withFileTypes: true })) {
          if (k.isDirectory() && k.name !== keep) { const q = path.join(p, k.name); fs.rmSync(q, { recursive: true, force: true }); removed.push(q); }
        }
        continue;
      }
      visit(p);
    }
  };
  if (fs.existsSync(root)) visit(root);
  return removed;
}

/** The files that must not ship (ELF / Mach-O), and the PE files built for another CPU (logged only). Reads 4 KiB each. */
function check(root, arch) {
  const bad = [];
  const otherPe = [];
  for (const f of walk(root)) {
    const fd = fs.openSync(f, 'r');
    const buf = Buffer.alloc(4096);
    let n = 0;
    try { n = fs.readSync(fd, buf, 0, 4096, 0); } finally { fs.closeSync(fd); }
    const k = binaryKind(buf.subarray(0, n));
    if (!k) continue;
    if (k.kind !== 'pe') bad.push(`${f} (${k.kind})`);
    else if (k.machine !== null && PE_MACHINE[arch] !== undefined && k.machine !== PE_MACHINE[arch]) otherPe.push(`${f} (PE machine 0x${k.machine.toString(16)})`);
  }
  return { bad, otherPe };
}

async function afterPack(context) {
  const platform = context.electronPlatformName;
  const arch = ARCH[context.arch] ?? String(context.arch);
  const keep = `${platform}-${arch}`;
  const unpacked = path.join(context.appOutDir, 'resources', 'app.asar.unpacked', 'node_modules');
  const removed = prune(unpacked, keep);
  console.log(`[after-pack] ${keep}: removed ${removed.length} build leftover folder(s)`);
  for (const r of removed) console.log(`[after-pack]   - ${path.relative(context.appOutDir, r)}`);
  if (platform !== 'win32') return; // this config builds Windows only; the check reads PE/ELF/Mach-O as Windows sees them
  const { bad, otherPe } = check(context.appOutDir, arch);
  for (const o of otherPe) console.log(`[after-pack] note: ${path.relative(context.appOutDir, o)}`);
  if (bad.length) throw new Error(`[after-pack] ${bad.length} non-Windows binar${bad.length === 1 ? 'y' : 'ies'} in the payload:\n${bad.map((b) => `  ${path.relative(context.appOutDir, b)}`).join('\n')}`);
}

module.exports = afterPack;
module.exports.default = afterPack;
module.exports.binaryKind = binaryKind;
module.exports.prune = prune;
module.exports.check = check;
