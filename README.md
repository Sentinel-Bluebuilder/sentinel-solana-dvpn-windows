# Sentinel dVPN for Windows (Solana devnet)

AI agents: the command-line guide is https://github.com/Sentinel-Bluebuilder/agentic-privacy-solana-devnet/blob/main/AGENTS.md

Devnet dVPN is a pure peer-to-peer dVPN app on the Sentinel Solana devnet protocol. Pick any server and pay it directly, or subscribe to any plan. No accounts, no servers in the middle. Electron + React + TypeScript; sessions run through the `dvpnd` daemon and the app signs owner transactions itself. Every app function is also a command (`devnet-dvpn ...`). Built on [Sentinel](https://sentinel.co).

## Download

Latest release: <https://github.com/Sentinel-Bluebuilder/sentinel-solana-dvpn-windows/releases/latest>

Latest release, **v0.3.0** (<https://github.com/Sentinel-Bluebuilder/sentinel-solana-dvpn-windows/releases/tag/v0.3.0>):

| Platform | File | SHA-256 |
|---|---|---|
| Windows 10/11 x64 | `Devnet-dVPN-Setup-0.3.0-rc.9-x64.exe` | `739faf6280ed34b0eec71b0f25f9e0e873a6d0a41eb04ea994e39785a2bb3bc9` |
| Checksums | `SHA256SUMS` | |

The installer's file name keeps "rc.9" because v0.3.0 is the same build as release candidate 9: the file was not rebuilt or renamed.

Earlier builds (0.3.0 release candidates, 0.2.1, 0.2.0, RC1 0.1.0): <https://github.com/Sentinel-Bluebuilder/sentinel-solana-dvpn-windows/releases>

## Languages (0.3.0 RC4)

The app speaks 15 languages besides English: Chinese (Simplified), Chinese (Traditional), Spanish, French, Portuguese, Russian, German, Korean, Hindi, Tamil, Indonesian, Malay, Filipino, Thai, Kurdish (Kurmanji). Pick one from the language menu at the bottom left of the sidebar; the choice is kept after a restart. A light | dark switch sits beside it.

RC4 also carries every fix of RC3.1: a second wallet on the same device no longer half-moves it (the switch is a step you confirm), Connect is refused before paying when the clock is off, and refunds list every device of your wallet.

**Known limits:** some status and error messages, the "System language" and "Language" labels, and the installer and Windows prompts still show in English; right-to-left languages (Arabic, Persian, Urdu, Pashto, Sorani) come later; no native speaker has reviewed the translations (the English sentence is the reference); devnet test tokens only.

## Status: devnet, unsigned

- Runs on the **Sentinel Solana devnet** only. Devnet tokens have no value; do not use a wallet that holds real funds.
- The latest release is **0.2.1**, built on the Sentinel Solana fork cut `final6.5` (`90014b2`, based on [sentinel-official/sentinel-solana](https://github.com/sentinel-official/sentinel-solana) `26de5240`). **0.3.0-rc4** is a pre-release candidate for the next version, built on fork cut `final6.14` (`0d8410f`, based on upstream `cb33092e`).
- Builds are **not code-signed by a publisher** (see the platform note below), so the OS will warn on first run. Verify the download against `SHA256SUMS` first.

## Verify a download

Download `SHA256SUMS` and the file(s) from the [release](https://github.com/Sentinel-Bluebuilder/sentinel-solana-dvpn-windows/releases/latest) into one folder, then:

PowerShell (Windows):

```powershell
Get-FileHash .\Devnet-dVPN-Setup-0.2.1-x64.exe -Algorithm SHA256
Select-String -Path .\SHA256SUMS -Pattern 'Devnet-dVPN-Setup-0.2.1-x64.exe'
```

The two hashes must match (`Get-FileHash` prints upper case, `SHA256SUMS` lower case; compare ignoring case).

Git Bash / WSL / Linux:

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

## Test results and known issues

Test results, the bug catalogue and open issues for every Sentinel dVPN client live in the testing-tools repository:

- Results and tools: <https://github.com/Sentinel-Bluebuilder/sentinel-solana-dvpn-testing-tools>
- Known issues for RC1/RC2: <https://github.com/Sentinel-Bluebuilder/sentinel-solana-dvpn-testing-tools/blob/main/docs/known-issues-rc1.md>

## License

[Sentinel dVPN License](LICENSE). Third-party components keep their own licenses: see [CREDITS.md](CREDITS.md). The installed app also carries `THIRD-PARTY-NOTICES.txt` in its folder.

Windows note: the installers are unsigned, so SmartScreen shows "Windows protected your PC": choose **More info > Run anyway**.

## Install

Run the installer, start **Devnet dVPN**, and follow the first-run setup (it creates a device wallet and installs the VPN service; one administrator prompt). Remove it from Settings > Apps, or run `devnet-dvpn daemon uninstall --yes` first to remove the service.

### From the command line (scripts, SSH, AI agents)

Use **v0.3.0-rc4** (x64 only; there is no ARM64 build of it yet). The older v0.2.1 cannot make a
key file, which you need over SSH: Windows cannot unlock a stored wallet there.

Run everything in an **elevated** PowerShell (an elevated terminal, or SSH as an administrator).
The installer and `daemon install` change the whole machine. From a normal shell they show a UAC
prompt that a script cannot answer, and with no desktop session they fail.

```powershell
$u = 'https://github.com/Sentinel-Bluebuilder/sentinel-solana-dvpn-windows/releases/download/v0.3.0-rc4'
$f = 'Devnet-dVPN-Setup-0.3.0-rc.4-x64.exe'
curl.exe -fsSLo $f "$u/$f"                     # curl.exe, not curl (an alias in older PowerShell)
curl.exe -fsSLo SHA256SUMS "$u/SHA256SUMS"
$h = ((Select-String -Path .\SHA256SUMS -SimpleMatch " $f").Line -split '\s+')[0]       # the line for this file
(Get-FileHash ".\$f" -Algorithm SHA256).Hash.ToLower() -eq $h   # must print True
$p = Start-Process -FilePath ".\$f" -ArgumentList '/S' -Wait -PassThru; $p.ExitCode      # 0 = installed; 3 = wrong CPU
$env:Path += ";$env:ProgramFiles\Devnet dVPN\bin"   # this shell only; new shells already have it
devnet-dvpn version --json
$env:DVPN_KEYFILE = "$PWD\agent-key.json"           # set it again in every new shell
devnet-dvpn wallet create --keyfile $env:DVPN_KEYFILE --yes --json
```

Run the installer with `Start-Process -Wait` as shown: started directly, it returns at once, so you
cannot tell when it finished or whether it failed.

Then fund the address, and run `device setup --yes` and `daemon install --yes`. If `daemon install`
answers `"relogin": true`, start a new SSH session before you connect. Every command is in
[docs/CLI.md](docs/CLI.md).

**Over SSH, leave the kill switch off.** With it on, the machine blocks all traffic outside the
tunnel, and a Windows cloud machine has been locked out that way. Turn it on only when you have
another way in, such as the cloud console.

## Build from source

Source: this tree is the source of v0.3.0, exported from commit 82ef4a4ccb331ada3602dd5674ee66d8936a0f9f (the commit the v0.3.0 installer was built from).

Comments, test titles and docs have internal project and team labels replaced. Besides those, 6 lines differ from commit 82ef4a4c, none of them in the app (`src/`): the GPL written offer in `build/deps.lock.json` names this repository's issue tracker, `scripts/i18n-banned.mjs` (a developer check) no longer defaults to a private file path, and 4 lines of `tests/unit/windows-account.test.ts` use the placeholder account name `user`.

```bash
npm ci
npm run typecheck
npm test
npm run package:win        # installer into dist/
npm run build:cli          # then: npm run cli -- help
```

Docs: [architecture](docs/ARCHITECTURE.md), [CLI](docs/CLI.md), [design](docs/DESIGN.md).
