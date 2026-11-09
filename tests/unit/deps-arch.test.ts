// ─── One installer per CPU type: lock file, staging and wrong-arch guards ───
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ES module without types
import { ARCHES, PE_MACHINE, localSource, lockProblems, peMachine, resolveDep } from '../../scripts/lib/deps-arch.mjs';

const lock = JSON.parse(readFileSync('build/deps.lock.json', 'utf8'));

/** A minimal PE header with the given Machine value. */
function fakePe(machine: number): Buffer {
  const b = Buffer.alloc(0x100);
  b.writeUInt16LE(0x5a4d, 0); // MZ
  b.writeUInt32LE(0x80, 0x3c);
  b.writeUInt32LE(0x00004550, 0x80); // PE\0\0
  b.writeUInt16LE(machine, 0x84);
  return b;
}

describe('deps.lock.json per arch', () => {
  it('has no problems for any arch', () => {
    expect(lockProblems(lock)).toEqual([]);
  });

  it('gives every dependency a different arm64 download, except Wintun (one zip, other DLL)', () => {
    for (const d of lock.deps) {
      const x = resolveDep(d, 'x64');
      const a = resolveDep(d, 'arm64');
      if (d.name === 'wintun') {
        expect(a.url).toBe(x.url);
        expect(a.files).toContain('wintun/bin/arm64/wintun.dll');
        expect(x.files).toContain('wintun/bin/amd64/wintun.dll');
      } else {
        expect(a.sha256).not.toBe(x.sha256);
        expect(a.url).toMatch(/arm64/);
        expect(x.url).not.toMatch(/arm64/);
      }
      // version, name, license and signer never differ between arches
      expect({ ...a, url: 0, sha256: 0, files: 0 }).toEqual({ ...x, url: 0, sha256: 0, files: 0 });
    }
  });

  it('keeps the top-level fields as the x64 build (old readers keep working)', () => {
    const wg = lock.deps.find((d: { name: string }) => d.name === 'wireguard');
    expect(resolveDep(wg, 'x64').url).toBe(wg.url);
    expect(resolveDep(wg, 'x64')).not.toHaveProperty('arm64');
  });

  it('takes locally built arm64 binaries from build/arm64', () => {
    for (const l of lock.local) {
      expect(localSource(l, 'x64')).toBe(l.path);
      expect(localSource(l, 'arm64')).toBe(`build/arm64/${l.name}.exe`);
    }
  });

  it('flags a missing arm64 block, a bad sha and a copy of the x64 file', () => {
    const bad = {
      deps: [
        { name: 'a', kind: 'exe', url: 'https://x/a.exe', sha256: 'f'.repeat(64) },
        { name: 'b', kind: 'exe', url: 'https://x/b.exe', sha256: 'e'.repeat(64), arm64: { sha256: 'nothex' } },
        { name: 'c', kind: 'exe', url: 'https://x/c.exe', sha256: 'd'.repeat(64), arm64: {} },
      ],
      local: [{ name: 'dvpnd', path: 'resources/bin/dvpnd.exe' }],
    };
    const p = lockProblems(bad).join('\n');
    expect(p).toMatch(/a: no arm64 block/);
    expect(p).toMatch(/b arm64: sha256 must be 64 hex/);
    expect(p).toMatch(/c: arm64 is the same file as x64/);
    expect(p).toMatch(/dvpnd: no arm64 path/);
  });

  it('refuses an unknown arch', () => {
    expect(() => resolveDep(lock.deps[0], 'x86')).toThrow(/unknown arch/);
    expect(ARCHES).toEqual(['x64', 'arm64']);
  });
});

describe('PE machine check', () => {
  it('reads x64 and arm64 headers', () => {
    expect(peMachine(fakePe(0x8664))).toBe(PE_MACHINE.x64);
    expect(peMachine(fakePe(0xaa64))).toBe(PE_MACHINE.arm64);
  });

  it('returns null for files that are not programs', () => {
    expect(peMachine(Buffer.from('geoip data'))).toBeNull();
    const noPe = fakePe(0x8664);
    noPe.writeUInt32LE(0, 0x80);
    expect(peMachine(noPe)).toBeNull();
  });
});

describe('wrong-arch guards', () => {
  it('the NSIS installer refuses the other CPU type with exit code 3', () => {
    const nsh = readFileSync('build/installer.nsh', 'latin1');
    expect(nsh).toMatch(/!ifdef APP_64\s+!ifndef APP_ARM64\s+\$\{If\} \$\{IsNativeARM64\}/);
    expect(nsh).toMatch(/!ifdef APP_ARM64\s+!ifndef APP_64\s+\$\{IfNot\} \$\{IsNativeARM64\}/);
    expect(nsh.match(/SetErrorLevel 3/g)?.length).toBe(2);
  });

  it('install-deps compares the machine CPU with the bundle before installing anything', () => {
    const ps = readFileSync('resources/scripts/install-deps.ps1', 'latin1');
    expect(ps).toContain("'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'");
    const check = ps.indexOf('if ($osArch -ne $bundleArch)');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(ps.indexOf('# --- WireGuard + AmneziaWG ---'));
  });

  it('electron-builder stages per arch and names installers by arch', () => {
    const yml = readFileSync('electron-builder.yml', 'utf8');
    expect(yml).toContain('from: build/stage/${arch}/resources');
    expect(yml).toContain('Devnet-dVPN-Setup-${version}-${arch}.${ext}');
    expect(yml).not.toMatch(/arch: \[/);
  });
});
