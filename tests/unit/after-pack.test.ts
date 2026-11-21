// ─── the agent tools rc.9 (Windows testing): the installer payload carries no build leftovers for other systems ───
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ap = require('../../scripts/after-pack.cjs') as {
  (ctx: { appOutDir: string; electronPlatformName: string; arch: number }): Promise<void>;
  binaryKind: (b: Buffer) => { kind: string; machine?: number | null } | null;
};

const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]);
const pe = (machine: number): Buffer => {
  const b = Buffer.alloc(0x100);
  b.write('MZ', 0, 'latin1');
  b.writeUInt32LE(0x80, 0x3c);
  b.writeUInt32BE(0x50450000, 0x80);
  b.writeUInt16LE(machine, 0x84);
  return b;
};

/** An unpacked app as the rc.8 installer had it. */
function app(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-'));
  const nm = path.join(root, 'resources', 'app.asar.unpacked', 'node_modules');
  const put = (rel: string, body: Buffer): void => { const f = path.join(nm, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };
  put('bigint-buffer/build/node_gyp_bins/python3', ELF);
  put('bigint-buffer/dist/node.js', Buffer.from('module.exports = 1;\n'));
  for (const p of ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-ia32', 'win32-x64']) put(`bufferutil/prebuilds/${p}/node.napi.node`, p === 'win32-x64' ? pe(0x8664) : p === 'win32-ia32' ? pe(0x14c) : ELF);
  put('rpc-websockets/node_modules/utf-8-validate/prebuilds/linux-x64/node.napi.node', ELF);
  put('rpc-websockets/node_modules/utf-8-validate/prebuilds/win32-x64/node.napi.node', pe(0x8664));
  return root;
}
const exists = (root: string, rel: string): boolean => fs.existsSync(path.join(root, 'resources', 'app.asar.unpacked', 'node_modules', rel));

describe('after-pack (rc.9)', () => {
  it('the rc.8 payload shape: node_gyp_bins and other-platform prebuilds go, win32-x64 stays, the check passes', async () => {
    const root = app();
    await ap({ appOutDir: root, electronPlatformName: 'win32', arch: 1 });
    expect(exists(root, 'bigint-buffer/build/node_gyp_bins')).toBe(false);
    expect(exists(root, 'bigint-buffer/dist/node.js')).toBe(true);
    for (const p of ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-ia32']) expect(exists(root, `bufferutil/prebuilds/${p}`)).toBe(false);
    expect(exists(root, 'bufferutil/prebuilds/win32-x64/node.napi.node')).toBe(true);
    expect(exists(root, 'rpc-websockets/node_modules/utf-8-validate/prebuilds/linux-x64')).toBe(false);
  });
  it('arm64 keeps win32-arm64 only', async () => {
    const root = app();
    fs.mkdirSync(path.join(root, 'resources/app.asar.unpacked/node_modules/bufferutil/prebuilds/win32-arm64'), { recursive: true });
    fs.writeFileSync(path.join(root, 'resources/app.asar.unpacked/node_modules/bufferutil/prebuilds/win32-arm64/node.napi.node'), pe(0xaa64));
    await ap({ appOutDir: root, electronPlatformName: 'win32', arch: 3 });
    expect(exists(root, 'bufferutil/prebuilds/win32-arm64/node.napi.node')).toBe(true);
    expect(exists(root, 'bufferutil/prebuilds/win32-x64')).toBe(false);
  });
  it('an ELF anywhere else in the payload fails the build, naming it', async () => {
    const root = app();
    fs.mkdirSync(path.join(root, 'resources', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(root, 'resources', 'bin', 'dvpnd'), ELF);
    await expect(ap({ appOutDir: root, electronPlatformName: 'win32', arch: 1 })).rejects.toThrow(/non-Windows binary in the payload:\n\s+resources[\\/]bin[\\/]dvpnd/);
  });
  it('binaryKind: ELF, Mach-O, PE machine, text', () => {
    expect(ap.binaryKind(ELF)?.kind).toBe('elf');
    expect(ap.binaryKind(Buffer.from([0xcf, 0xfa, 0xed, 0xfe]))?.kind).toBe('macho');
    expect(ap.binaryKind(pe(0x8664))).toEqual({ kind: 'pe', machine: 0x8664 });
    expect(ap.binaryKind(Buffer.from('#!/bin/sh\n'))).toBeNull();
  });
  it('electron-builder runs it', () => {
    expect(fs.readFileSync(path.resolve('electron-builder.yml'), 'utf8')).toMatch(/^afterPack: scripts\/after-pack\.cjs$/m);
  });
});
