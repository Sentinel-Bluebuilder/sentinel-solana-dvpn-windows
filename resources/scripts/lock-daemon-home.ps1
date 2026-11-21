# Lock the daemon home (run ELEVATED, from setup-daemon.ps1, apply-daemon-config.ps1 and the installer).
#
# The home keeps session credentials (WireGuard/AmneziaWG private keys, the OpenVPN login, the
# Hysteria2 password, the V2Ray/Xray client ids) and the device key. Cosmos lessons T13/T14 (sdk
# ai-path/FAILURES.md); found readable on ddv-win-c 2026-10-22. cb33's `service install` already sets
# the instance folder to SYSTEM + Administrators only; this adds back read for Users on the folder
# and config.toml (Settings and `sentinel-dvpnd doctor` run as the user) and keeps the rest closed:
#   home and below:      SYSTEM + Administrators full, Users read only
#   keys + protocol dirs: SYSTEM + Administrators only; Users may read <protocol>\config.toml
# cb33 layout: <home>\keys, <home>\<protocol>. A pre-cb33 home (kept after an upgrade, or a .prev-
# copy) has them under <home>\client\: both are handled. SIDs, not names, so it works on any
# Windows language. ASCII only.
param(
  [Parameter(Mandatory = $true)][string]$DaemonHome
)
$ErrorActionPreference = 'Stop'
$system = '*S-1-5-18'; $admins = '*S-1-5-32-544'; $users = '*S-1-5-32-545'

function Lock-Path([string]$path, [string[]]$grants) {
  & icacls $path /inheritance:r /grant:r @grants | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "could not restrict $path" }
}

if (-not $DaemonHome.StartsWith($env:ProgramData, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'daemon home must be under ProgramData' }
if (-not (Test-Path -LiteralPath $DaemonHome -PathType Container)) { throw "no daemon home at $DaemonHome" }

Lock-Path $DaemonHome @("${system}:(OI)(CI)F", "${admins}:(OI)(CI)F", "${users}:(OI)(CI)RX")

$roots = @($DaemonHome)
$legacy = Join-Path $DaemonHome 'client'
if (Test-Path -LiteralPath $legacy -PathType Container) { $roots += $legacy }
foreach ($root in $roots) {
  foreach ($d in 'keys', 'wireguard', 'amneziawg', 'openvpn', 'hysteria2', 'v2ray', 'xray') {
    $p = Join-Path $root $d
    if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Force -Path $p | Out-Null }
    Lock-Path $p @("${system}:(OI)(CI)F", "${admins}:(OI)(CI)F")
    $cfg = Join-Path $p 'config.toml'
    if ($d -ne 'keys' -and (Test-Path -LiteralPath $cfg -PathType Leaf)) {
      & icacls $cfg /grant "${users}:(R)" | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "could not let users read $cfg" }
    }
  }
}
'locked'
