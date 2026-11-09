// ─── deps-arch — per-arch view of build/deps.lock.json (pure, unit-tested) ───
// Top-level fields of a dep are the x64 build; an `arm64` block overrides them.

export const ARCHES = ['x64', 'arm64'];

/** PE "Machine" field per installer arch (IMAGE_FILE_MACHINE_AMD64 / _ARM64). */
export const PE_MACHINE = { x64: 0x8664, arm64: 0xaa64 };

export function checkArch(arch) {
  if (!ARCHES.includes(arch)) throw new Error(`unknown arch "${arch}" (want ${ARCHES.join(' or ')})`);
  return arch;
}

/** The dep as the given arch needs it: url/sha256/files from its arch block when present. */
export function resolveDep(dep, arch) {
  checkArch(arch);
  const { arm64, ...base } = dep;
  if (arch === 'x64') return base;
  if (!arm64) throw new Error(`${dep.name}: no arm64 block in deps.lock.json`);
  return { ...base, ...arm64 };
}

/** Where a locally built binary comes from for this arch (`path` = x64 dev tree). */
export function localSource(entry, arch) {
  checkArch(arch);
  if (arch === 'x64') return entry.path;
  if (!entry.arm64?.path) throw new Error(`${entry.name}: no arm64 path in deps.lock.json`);
  return entry.arm64.path;
}

/** PE Machine of a Windows executable or DLL, or null when the bytes are not a PE file. */
export function peMachine(buf) {
  if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) return null;
  const pe = buf.readUInt32LE(0x3c);
  if (pe + 6 > buf.length || buf.readUInt32LE(pe) !== 0x00004550) return null;
  return buf.readUInt16LE(pe + 4);
}

/** Every problem with the lock file, as plain sentences (empty = fine). */
export function lockProblems(lock) {
  const out = [];
  for (const d of lock.deps ?? []) {
    for (const arch of ARCHES) {
      let r;
      try {
        r = resolveDep(d, arch);
      } catch (e) {
        out.push(e.message);
        continue;
      }
      if (!/^https:\/\//.test(r.url ?? '')) out.push(`${d.name} ${arch}: url must be https`);
      if (!/^[0-9a-f]{64}$/.test(r.sha256 ?? '')) out.push(`${d.name} ${arch}: sha256 must be 64 hex chars`);
      if (r.kind === 'zip' && !(r.files?.length > 0)) out.push(`${d.name} ${arch}: zip needs files`);
    }
    const x = resolveDep(d, 'x64');
    const a = d.arm64 ? resolveDep(d, 'arm64') : null;
    // Same download for both arches is fine only when the arch picks different files (Wintun).
    if (a && a.sha256 === x.sha256 && JSON.stringify(a.files) === JSON.stringify(x.files)) {
      out.push(`${d.name}: arm64 is the same file as x64`);
    }
  }
  for (const l of lock.local ?? []) {
    try {
      localSource(l, 'arm64');
    } catch (e) {
      out.push(e.message);
    }
  }
  return out;
}
