# Windows installer — Devnet dVPN

One file for the user: `Devnet-dVPN-Setup-<version>-x64.exe`. They run it, accept one
administrator prompt, and every protocol is ready. Nothing is downloaded at install time.

## What the user gets

| Step | What happens | Where |
|---|---|---|
| Welcome + license | our license (Sentinel dVPN License), then every bundled component's license and source link | `build/license.txt` (generated) |
| Install folder | default `C:\Program Files\Devnet dVPN`, changeable; per-machine | NSIS `perMachine` |
| Files | app, `dvpnd.exe`, `pipe-bridge.exe`, V2Ray / Xray / Hysteria2 binaries, driver MSIs, PowerShell helpers | `resources\resources\` |
| VPN drivers | WireGuard 1.1.1, AmneziaWG 3.1.0, OpenVPN 2.6.23 + "OpenVPN Wintun" adapter, installed silently if missing | `install-deps.ps1` |
| CLI | `devnet-dvpn` on the machine PATH (new terminals) | `bin\devnet-dvpn.cmd` |
| Shortcuts | Start menu + desktop, "Run Devnet dVPN" on the last page | NSIS |
| Notices | `LICENSE.txt`, `THIRD-PARTY-NOTICES.txt` in the install folder | `extraFiles` |

Not done at install, by design: wallet, device key, and the VPN Windows service
(`sentinel-dvpnd$c0`, home `%ProgramData%\sentinel-dvpn\c0`; before cb33 it was `dvpnd` in
`%ProgramData%\dvpnd\client`). The service needs the owner's address and a funded, permitted
device, so the app's first-run setup, or `devnet-dvpn daemon install --yes`, installs it (one more
admin prompt, `setup-daemon.ps1`). An update over an installed service re-runs `setup-daemon.ps1`
itself.

## Dependencies are pinned and verified twice

`build/deps.lock.json` pins every third-party program by version, URL and SHA-256.

1. **Build time** — `scripts/fetch-deps.mjs` downloads into `build/.deps-cache/` (or reuses
   it), refuses any hash mismatch, copies MSIs to `resources/deps/` and extracts only the
   listed files from the zips. It writes `resources/deps/deps.json` (name, version, file,
   SHA-256, Authenticode signer), `build/THIRD-PARTY-NOTICES.txt` and `build/license.txt`.
2. **Install time** — `install-deps.ps1` re-hashes each MSI and checks that its Authenticode
   signature is **Valid** and that the signer is the expected publisher (WireGuard LLC,
   Privacy Technologies OU, OpenVPN Inc.) before `msiexec` runs it.

Bumping a dependency: change `url` + `version` + `sha256` in the lock file, rerun
`npm run deps:fetch`, then prove that protocol live (BOX-RIG → Laptop client).

## install-deps.ps1 rules

- Already installed → left alone. Older WireGuard / AmneziaWG → upgraded, **but never while
  one of its tunnels is running** (that would drop the connection).
- OpenVPN **2.7+ is never downgraded**: it is reported `incompatible` (2.7 removed Wintun,
  UPSTREAM-GAPS #21) and Diagnostics tells the user to uninstall it, then Repair.
- WireGuard / AmneziaWG install with `DO_NOT_LAUNCH=1`; their GUI manager service is
  stopped (dvpnd drives tunnels itself).
- MSI exit 3010 / 1641 = success, `rebootRequired` set.
- `-CheckOnly` reports without installing (no admin). The app's Diagnostics and
  `devnet-dvpn daemon drivers` use it; **Repair drivers** / `daemon repair-drivers --yes`
  run it elevated.
- Report: `%ProgramData%\Devnet dVPN\install-deps.json` (+ `.log`, `msi-<name>.log`).
- Exit 0 = ready, 2 = something missing. The installer then shows one warning (skipped in
  silent mode) and finishes: the protocols that are ready still work.
- PowerShell scripts that 5.1 runs stay **ASCII-only**: 5.1 reads BOM-less UTF-8 as
  cp1252, and a `→` turns into a stray quote that breaks the script.

## Install / upgrade / uninstall hooks (`build/installer.nsh`)

| Hook | Does |
|---|---|
| `customInit` | clear `PSModulePath` (Q0576: a PowerShell 7 parent broke every 5.1 child); if `sentinel-dvpnd$c0` (or a pre-cb33 `dvpnd`) runs, stop it cleanly (ends the session, releases kill switch + DNS) so its files can be replaced |
| `customInstall` | `install-deps.ps1`; `path-entry.ps1` adds `$INSTDIR\bin`; a folder outside Program Files is restricted to administrators; an update from pre-cb33 runs `daemon migrate --yes` (`%ProgramData%\dvpnd\client` → `%ProgramData%\sentinel-dvpn\c0`); an update with a service home re-runs `setup-daemon.ps1` and starts the service, logged in `%ProgramData%\sentinel-dvpn\c0\install-update.log` |
| `customUnInit` | stop the service + `pipe-bridge`; copy the cleanup scripts + `dvpnd.exe` to `$PLUGINSDIR` |
| `customUnInstall` | full uninstall only (not an upgrade): `uninstall-cleanup.ps1` (restore the user's proxy, remove the service, remove leftover `WireGuardTunnel$dvpn-*` / `AmneziaWGTunnel$dvpn-*`), take the CLI off PATH |

electron-builder deletes `$INSTDIR` **before** `customUnInstall`, which is why the scripts
are copied out in `customUnInit`. The installer is a 32-bit process: hooks call the 64-bit
PowerShell through `%WINDIR%\sysnative`, and scripts use `ProgramW6432`.

Kept on uninstall on purpose: the shared drivers (other apps may use them) and
`%ProgramData%\sentinel-dvpn\c0` (the device key holds an on-chain permission and SOL; a
reinstall picks it up again).

## Packaging rule: main and CLI are self-contained bundles

electron-builder 25 re-nests deduplicated npm packages: it shipped `@solana/options`
without the `@solana/codecs-core` it requires, and both the app and the CLI crashed on
start. The main process (`electron.vite.config.ts`) and the CLI (`scripts/build-cli.mjs`)
therefore bundle every runtime dependency; only `electron` and ws's optional native addons
stay external. Anchor is aliased to its CJS build (its ESM build keeps bare `require()`s).

## CLI shim

`bin\devnet-dvpn.cmd` runs the bundled CLI on the app's own runtime
(`ELECTRON_RUN_AS_NODE=1 "Devnet dVPN.exe" resources\app.asar\out\cli\devnet-dvpn.cjs`),
the same pattern as VS Code's `code.cmd`. CRLF line endings (`.gitattributes`).

## Build

```bash
npm run release:win          # fetch-deps → typecheck → unit tests → build → CLI → electron-builder → SHA256SUMS
node scripts/release-win.mjs --offline   # cache only (no downloads)
npm run icon                 # build/icon.svg → build/icon.ico + icon.png (Electron renders it)
```

Output: `dist/Devnet-dVPN-Setup-<version>-x64.exe` and `…-arm64.exe`, `.blockmap`s,
`SHA256SUMS.txt`. `--arch x64|arm64` builds one; the default `all` builds both.
`dvpnd.exe` and `pipe-bridge.exe` must be in `resources/bin/` (x64) and `build/arm64/`
(ARM64) first (local builds, never committed; the lock file's `local` list is checked).
Heavy builds run on a VM, not the owner's laptop: `scripts/e2e/vm-build-release.ps1`
takes a hash-checked kit (`src.zip` = `git archive HEAD`, `bin-x64/`, `bin-arm64/`) in
`C:\ddv\kit` and writes the installers to `C:\ddv\out`.

## ARM64 (Windows on ARM: Snapdragon, Surface)

One installer per CPU type. A combined installer would double the ~154 MB download.
- **Lock file:** every dependency has an `arm64` block (url + sha256, or other `files` for
  Wintun: same zip, `bin/arm64/wintun.dll`). All seven have official ARM64 builds. Hashes
  were checked against the publishers' digests and MSI signers verified (2026-10-22).
- **Staging:** `node scripts/fetch-deps.mjs --arch arm64` fills `build/stage/arm64/resources`.
  It never touches the x64 dev tree. `--arch x64` (the default) fills `resources/` as before and
  mirrors it to `build/stage/x64`. electron-builder takes `build/stage/${arch}/resources`.
  The run fails if any staged `.exe`/`.dll` has the wrong PE machine
  (x64 `0x8664`, ARM64 `0xAA64`).
- **dvpnd / pipe-bridge:** pure Go, no cgo: `GOOS=windows GOARCH=arm64 CGO_ENABLED=0`
  with the same devnet ldflags, from a clean `git archive` of the engine commit
  (`npm run build:bridge:arm64` for pipe-bridge). Place both in `build/arm64/`.
- **Wrong CPU:** `installer.nsh` refuses the other CPU type with a plain message and **exit 3**.
  Without that guard, the x64 installer would install under emulation on ARM64 and its VPN
  drivers would never load. `install-deps.ps1` checks again: it compares the machine CPU from
  the registry (true even from an emulated PowerShell) with `deps.json`'s `arch` and reports
  `incompatible` before running any MSI.
- **OpenVPN on ARM64 uses DCO, not Wintun** (gap #83): OpenVPN's ARM64 MSI ships no Wintun
  driver, so `install-deps.ps1` / `openvpn-adapter.ps1` create the adapter "OpenVPN Data Channel
  Offload" (hwid `ovpn-dco`) on ARM64 and "OpenVPN Wintun" on x64, picked by the machine CPU
  in the registry. `daemon drivers` and Diagnostics show "OpenVPN DCO adapter" there.
- **Build check:** in `win-arm64-unpacked` all 15 programs are AA64 (Electron, dvpnd, pipe-bridge,
  xray, v2ray, hysteria2, wintun.dll, ...); only electron-builder's `elevate.exe` and the NSIS
  setup stub are x86, which Windows on ARM runs under its x86 emulation.
- **Proof:** every function on a Windows 11 ARM64 VM (QEMU emulation on GCP; GCP has no
  Windows on Arm). Tracked cell by cell in `docs/PLATFORM-MATRIX.md`. Speed numbers from
  emulation are never quoted. Real Snapdragon hardware = owner item. See "Proof — Windows 11".

## Proof — Windows 11 x64 + ARM64 (2026-10-23; release candidates from 2026-10-24)

Rig: `docs/WIN11-RIG.md` (Win11 Pro 25H2 x64 under KVM, Win11 Pro ARM64 under QEMU TCG, both
stock security defaults: SmartScreen, Smart App Control, Defender, UAC). Evidence per cell in
`evidence/win11-x64/`, `evidence/win11-arm64/` (logs in each `logs/`), summed in
`docs/PLATFORM-MATRIX.md`.
- **Byte-identical builds:** dvpnd cross-built on the rig host from `git archive` of the engine
  commit matches the engine's x64 build and connect-8b's arm64 build byte for byte (ddv18.17,
  18.19, 18.20), so the installers carry the binaries the Server 2022 rounds tested.
- **x64 (installer 15, carried to 20 except billing, I7/I8, split-by-app):** W1–W3, W5, W6 PASS
  (signature, Smart App Control, Defender scan, one UAC prompt, wrong-CPU refusal); build gate
  inside the guest (typecheck, unit tests, CLI map, cli-e2e, settings-e2e, ui-smoke both themes,
  mojibake) PASS; CLI sweep 232/0; matrix 59 PASS / 1 FAIL (xray per-app "node not reachable",
  rerun on 20); safety dns, killswitch, wholedevice, split, splitroutes, splitapps, kssplit,
  splitcli, doctor, killdaemon, persist, mtu 0 FAIL; protocols + firewall shields fail only
  Hysteria2's 10 MB download, which the e2-micro node caps at ~0.5 Mbps for every client (#85).
- **Release candidates and the evidence rule.** From build 28 on, `evidence/win11-*/BUILD` names
  the current candidate only (no carry), so every cell above is history until rerun on it.
  - **28** (app 2b91cee, dvpnd 18.25; x64 `7995796c`, arm64 `0c5609b6`): x64 firstrun 9/0,
    matrix 60 PASS / 4 NA (two V2Ray/Xray system-proxy cells open: no Edge in that image).
    Superseded by 29.
  - **29** (app a57db4f, dvpnd 18.31 from cf4c 17eb36a, cross-built byte-identical: x64
    `68c252bd`, arm64 `79a6d186`; setups x64 `875fc83c`, arm64 `47c1e5a2`): **failed on a clean
    PC, both CPUs: no OpenVPN.** Passing only `REMOVE=OpenVPN.GUI,…` to the OpenVPN MSI on a
    fresh install makes it remove everything, with exit 0 (gap #93).
  - **30**: names the OpenVPN features with `ADDLOCAL`. The list must differ by CPU: the arm64
    MSI has no `Drivers.Wintun` feature, and naming it fails the install with 1603 / error 2711
    (proven on the ARM64 guest; the same list without it installs with exit 0, no GUI).
- **ARM64 kill switch fix (gap #89, in 18.25):** the 12/30 ARM64 kill-switch result on build 26
  was not the firewall. WireGuard's readiness probe timed out on the slow emulated CPU, the 5 s
  teardown then failed silently and left the `dvpn-wg-client` tunnel service running, and every
  later case failed behind it. 18.25 waits up to 45 s for readiness and retries teardown twice
  (30 s each) with logged errors. The ARM64 rerun on 18.25 is pending.
- **W4 (drivers under memory integrity / HVCI) is BLOCKED on both VMs:** Hyper-V cannot start in
  a guest that is itself a GCP VM (the x64 guest stopped booting). Real hardware only.
- **ARM64:** drivers ready natively (WireGuard, AmneziaWG, OpenVPN 2.6.23 + DCO adapter); I6
  driver repair PASS (adapter + AmneziaWG removed, `repair-drivers` restored both). Installer
  cells are BLOCKED under TCG: x86 emulation (the setup stub, elevate.exe) is broken in QEMU,
  so the app runs from the unpacked arm64 tree, installed the way the installer does it.

## Signing

Unsigned builds work but SmartScreen shows **"Unknown publisher"** and may need
"More info → Run anyway". To sign: put an OV/EV code-signing certificate in `CSC_LINK`
(path or base64 `.pfx`) and its password in `CSC_KEY_PASSWORD`; electron-builder then signs
the app, every bundled `.exe`, the uninstaller and the setup file. **Owner decision
pending:** no certificate exists yet.

## Silent install (IT / test rigs)

```bat
Devnet-dVPN-Setup-0.1.0-x64.exe /S              :: all users, default folder
Devnet-dVPN-Setup-0.1.0-x64.exe /S /D=D:\Apps\Devnet dVPN
"C:\Program Files\Devnet dVPN\Uninstall Devnet dVPN.exe" /S
```

## Proof — clean Windows VM (2026-10-20)

Fresh GCP Windows Server 2022 VM, nothing preinstalled, real setup `.exe` from
`npm run release:win`, driven by `scripts/e2e/vm-installer-test.ps1` (VM deleted afterwards).

| phase | result |
|---|---|
| silent install | exit 0 in 70 s; **25/25 checks**: app + `dvpnd`/`pipe-bridge`/v2ray/xray/hysteria2 present, WireGuard 1.1.1 + AmneziaWG 3.1.0 + OpenVPN 2.6.23 installed and their managers not running, "OpenVPN Wintun" adapter, `install-deps.json` ok, CLI on PATH in a new shell, `daemon drivers` ready, Apps & features + Start menu entries |
| first run | new wallet (key file: DPAPI has no key for an SSH logon) → `daemon init` → `device setup` → `daemon install` (Administrator: elevated step ran with no prompt) → WireGuard connect: exit IP = node, 51 Mbps → disconnect: direct IP back → `settle run` → `device revoke` → funds returned |
| upgrade over the top | exit 0 in 57 s; service stopped before files were replaced and Running after; one PATH entry; drivers untouched |
| uninstall | **9/9**: exit 0, service removed, no `dvpn-*` tunnel services, CLI off PATH, system proxy off, internet works, shared drivers and device key folder kept |

Bugs this run found and fixed: packaged app crashed on a dropped nested npm package (bundles
are now self-contained); the old uninstall hook ran a script already deleted (copied to
`$PLUGINSDIR` first); a false "Something went wrong" after a successful connect; a false
"DNS could not be restored" (UPSTREAM-GAPS #25); RPC hanging through WireGuard on a 1460-MTU
node host (UPSTREAM-GAPS #26).
