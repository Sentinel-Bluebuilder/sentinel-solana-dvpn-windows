# Sentinel dVPN for Windows (Solana devnet)

Devnet dVPN is a pure peer-to-peer dVPN app on the Sentinel Solana devnet protocol. Pick any server and pay it directly, or subscribe to any plan. No accounts, no servers in the middle. Electron + React + TypeScript; sessions run through the `dvpnd` daemon and the app signs owner transactions itself. Every app function is also a command (`devnet-dvpn ...`). Built on [Sentinel](https://sentinel.co).

## Download

Latest release: <https://github.com/Sentinel-Bluebuilder/sentinel-solana-dvpn-windows/releases/latest>

| Platform | File |
|---|---|
| Windows 10/11 x64 | `Devnet-dVPN-Setup-0.2.0-x64.exe` |
| Windows 11 ARM64 | `Devnet-dVPN-Setup-0.2.0-arm64.exe` |
| Earlier build (RC1) | `Devnet-dVPN-Setup-0.1.0-x64.exe` / `-arm64.exe` |
| Sentinel CLI + daemon (x64 / arm64) | `sentinel-dvpn-windows-<arch>.exe`, `sentinel-dvpnd-windows-<arch>.exe` |
| Checksums | `SHA256SUMS` |

All files: <https://github.com/Sentinel-Bluebuilder/sentinel-solana-dvpn-windows/releases/latest>

## Status: devnet, release candidate, unsigned

- Runs on the **Sentinel Solana devnet** only. Devnet tokens have no value; do not use a wallet that holds real funds.
- This is **release candidate 2 (RC2)**, built on the Sentinel Solana fork cut `final6.1` (`02b22fc`, based on [sentinel-official/sentinel-solana](https://github.com/sentinel-official/sentinel-solana) `26de5240`).
- Builds are **not code-signed by a publisher** (see the platform note below), so the OS will warn on first run. Verify the download against `SHA256SUMS` first.

## Verify a download

Download `SHA256SUMS` and the file(s) from the [release](https://github.com/Sentinel-Bluebuilder/sentinel-solana-dvpn-windows/releases/latest) into one folder, then:

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

## Test results and known issues

Test results, the bug catalogue and open issues for every Sentinel dVPN client live in the testing-tools repository:

- Results and tools: <https://github.com/Sentinel-Bluebuilder/sentinel-solana-dvpn-testing-tools>
- Known issues for RC1/RC2: <https://github.com/Sentinel-Bluebuilder/sentinel-solana-dvpn-testing-tools/blob/main/docs/known-issues-rc1.md>

## License

[Sentinel dVPN License](LICENSE). Third-party components keep their own licenses (see `THIRD-PARTY-NOTICES`).

Windows note: the installers are unsigned, so SmartScreen shows "Windows protected your PC": choose **More info > Run anyway**.

## Install

Run the installer, start **Devnet dVPN**, and follow the first-run setup (it creates a device wallet and installs the VPN service; one administrator prompt). Remove it from Settings > Apps, or run `devnet-dvpn daemon uninstall --yes` first to remove the service.

## Build from source

```bash
npm ci
npm run typecheck
npm test
npm run package:win        # installer into dist/
npm run build:cli          # then: npm run cli -- help
```

Docs: [architecture](docs/ARCHITECTURE.md), [CLI](docs/CLI.md), [design](docs/DESIGN.md), [network safety](docs/NETWORK-SAFETY.md).
