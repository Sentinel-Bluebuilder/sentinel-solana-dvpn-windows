# OpenVPN self-build — corresponding-source reproducibility proof

## What this is

We ship the **official** OpenVPN Community `2.6.23-I002` MSI (pinned in `build/deps.lock.json`,
signed by "OpenVPN Inc.", downloaded from `swupdate.openvpn.net`). The installer
(`resources/scripts/install-deps.ps1`) verifies each bundled MSI by SHA-256 **and** a Valid
Authenticode signature **and** signer subject.

OpenVPN's I002 Windows installer is an **untagged rebuild** of the same `2.6.23` program; its exact
build scripts are not published under a tag. The closest **published** build scripts are the
`openvpn-build` tag `OpenVPN-2.6.23-I001` (commit `5d4139bbda6feea5077954bbbb717c256c71ba03`). To
make the GPL-2.0 corresponding-source offer airtight, we built the MSI ourselves from that published
tag and the exact `2.6.23` program source, and verified it is **structurally identical** to the
shipped I002 MSI.

Evidence: `evidence/openvpn-selfbuild/diff-vs-I002.txt` (structural
tables) and `evidence/openvpn-selfbuild/version-diff-vs-I002.txt`
(per-file Version -- the GPL corresponding-source check).

## Result

For **both** architectures, our I001-built MSI matches the official I002 MSI exactly on the
installer's structural tables (diffs ignore FileSize/Version/Language, which legitimately differ
build-to-build):

| Arch  | Template     | Feature | Component (incl. ComponentId GUIDs, Directory_, Attributes) | File set |
|-------|--------------|---------|-------------------------------------------------------------|----------|
| amd64 | `x64;1033`   | IDENTICAL (16) | IDENTICAL (117) | IDENTICAL (79) |
| arm64 | `Arm64;1033` | IDENTICAL (15) | IDENTICAL (115) | IDENTICAL (79) |

Our build SHA-256:
- `OpenVPN-2.6.23-I001-amd64.msi` — `c7be021f4573c2f2861389a7ad3d10971bde00729f4978b0b92ebaf61b6a6850`
- `OpenVPN-2.6.23-I001-arm64.msi` — `82d42ffda94e67c705ccc61417b2790b2bc583ce3c5a9b9d98e616e74dcdf7ed`

Conclusion: the published I001 scripts + `2.6.23` source reproduce an MSI that installs identically
to the shipped I002 (same feature tree, same component GUIDs/directories/attributes, same file set,
same architecture). The corresponding source pinned in `deps.lock.json` is complete and buildable.

## GPL corresponding-source: per-file Version check

The structural diff above ignores the File-table FileSize/Version/Language columns (they legitimately
differ build-to-build). Version is exactly where an I00x rebuild differs, so it is checked separately
per file (#29): every GPL-covered file must carry the same version in our I001 build and the shipped
I002, and every file that differs must be non-GPL.

Result (both arches): all GPL files match -- `openvpn.exe` / `openvpnserv.exe` / `tapctl.exe` at
2.6.23.0 (both built from source commit `v2.6.23/49620843c487a7fe`, statically linked LZO 2.10),
`openvpn-gui.exe` / `libopenvpn_plap.dll` at 11.66.0.0. The only version differences are non-GPL
dependency bumps: OpenSSL 3.6.3 -> 3.6.5 (Apache-2.0) and `ovpn-dco.sys` 1.3.3 -> 1.3.4 (MIT,
prebuilt). File-size deltas are the OpenVPN Inc. Authenticode signature plus ordinary build noise,
not a source difference. So I002 is an installer-only dependency refresh, and the published I001
`openvpn-build` scripts + 2.6.23 source are the complete corresponding source for every GPL binary
in the shipped MSI. See
`evidence/openvpn-selfbuild/version-diff-vs-I002.txt`.

## Why we still ship the official I002 (not our build)

`install-deps.ps1` requires every bundled MSI to present a **Valid** Authenticode signature whose
signer subject matches `deps.lock`. A self-signed/dev certificate reports `NotTrusted`/`UnknownError`
on a clean user machine and the installer refuses it. This project has **no** real (OV/EV)
code-signing certificate yet (`scripts/release-win.mjs` leaves installers unsigned when `CSC_LINK`
is unset; see `docs/INSTALLER.md`). Shipping our own OpenVPN MSI therefore has to wait until a
code-signing certificate is purchased; until then the official I002 (signed by OpenVPN Inc.) is the
only build that passes the gate. When a certificate exists, switching to our build is: sign both
MSIs, host them (or bundle locally), and repin `url`/`sha256`/`signer` in `deps.lock.json`.

## Reproduce

Toolchain (Windows build host): CMake, Ninja, Python + docutils (rst2html), NASM, Perl, WiX Toolset
v3.14, `unzip.exe` on PATH, and MSVC **with the Spectre-mitigated VC runtime libraries** for every
toolset/arch used (openvpn's `CMakeLists.txt` adds `/Qspectre`, so the Spectre libs are mandatory).

```
git clone --recursive https://github.com/OpenVPN/openvpn-build
cd openvpn-build && git checkout OpenVPN-2.6.23-I001 && git submodule update --init --recursive
# in a VS dev shell for the target arch (host x64), with the Spectre-equipped VS instance selected:
#   $env:CMAKE_GENERATOR_INSTANCE = '<VS install path that HAS the Spectre libs>'
#   $env:WIX = 'C:\Program Files (x86)\WiX Toolset v3.14\'   # install ROOT (tools live in <WIX>bin\)
cd windows-msi
.\build-and-package.ps1 -arch amd64      # then: -arch arm64
# MSIs land in windows-msi\image\OpenVPN-2.6.23-I001-<arch>.msi
```

Notes from our build (all upstream behaviour preserved):
- `/Qspectre` is kept (upstream hardening); the Spectre-mitigated VC libs must be installed. Install
  them with the component set in the **initial** VS Build Tools install (incremental `modify` of an
  existing instance does not apply them in a non-interactive session); then point CMake's VS
  generator at that instance with `CMAKE_GENERATOR_INSTANCE` so MSBuild uses its toolset.
- The kernel/driver components (tap-windows6, wintun, ovpn-dco, OpenVPNServ2) are **downloaded
  pre-signed binaries**, not compiled; only user-mode `openvpn.exe`/`openvpn-gui.exe` are built.

Structural verification (Linux, `msitools`):
```
msiinfo suminfo <msi>                    # Template = platform
msiinfo export <msi> Feature|Component|File   # compare ours vs the official I002 export
```
