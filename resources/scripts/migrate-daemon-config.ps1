# Bring the service's config.toml to what this app writes, before the service starts.
#
# cb33 layout: ONE <home>\config.toml (cb33 `init` writes it fresh, so the old key renames of the
# cf4c era do not apply here; `devnet-dvpn daemon migrate` carries an older home's settings in).
# Run ELEVATED by the installer (upgrade) and by setup-daemon.ps1. Idempotent. Writes UTF-8
# without BOM and keeps one .pre-migrate backup. ASCII only.
param(
  # The service home (manager.ts DEFAULT_DAEMON_HOME, layout.ts instanceDir): %ProgramData%\sentinel-dvpn\c0.
  [string]$DaemonHome = (Join-Path $env:ProgramData 'sentinel-dvpn\c0')
)
$ErrorActionPreference = 'Stop'
$cfg = Join-Path $DaemonHome 'config.toml'
if (-not (Test-Path -LiteralPath $cfg -PathType Leaf)) {
  Write-Output "migrate-daemon-config: no service home at $DaemonHome (fresh install), nothing to do"
  exit 0
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
$changed = 0

# Kill switch 'on' -> 'persist' (11-07): the daemon's 'on' lifts the block whenever the service stops,
# so a restart or an update sent traffic direct. The app has one "On" = persist (config.ts
# writtenKillSwitch); this moves older configs and init's default 'on' before the service starts.
# 'off' and 'persist' are left alone. Except after an uninstall: uninstall-cleanup.ps1 stepped persist
# down to 'on' and left $ksMark, so the reinstall's first start releases the block row the kept home
# still holds (gap #84) instead of cutting the PC off. The installer and setup-daemon.ps1 both run this
# before that start, so the marker stays here; setup-daemon.ps1 removes it once the service runs.
$ksMark = Join-Path $DaemonHome '.ks-stepped-down'   # written by uninstall-cleanup.ps1
$text = [System.IO.File]::ReadAllText($cfg)
if (Test-Path -LiteralPath $ksMark -PathType Leaf) {
  Write-Output "kill switch kept at 'on' for the first start after a reinstall ($ksMark)"
} else {
  $new = [regex]::Replace($text, "(?m)^(\s*kill_switch\s*=\s*)(['""])on(['""])", '${1}${2}persist${3}')
  if ($new -ne $text) {
    Copy-Item -LiteralPath $cfg -Destination "$cfg.pre-migrate" -Force
    [System.IO.File]::WriteAllText($cfg, $new, $utf8)
    $changed++
    Write-Output "migrated $cfg (kill switch on -> persist)"
  }
}

# V2Ray/Xray whole-device mode: default ON for a service config without a `tun` key.
# A config that already says `tun = ...` (the user chose) is left alone.
foreach ($s in 'v2ray', 'xray') {
  $path = Join-Path (Join-Path $DaemonHome $s) 'config.toml'
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
  $text = [System.IO.File]::ReadAllText($path)
  if ($text -match '(?m)^\s*tun\s*=') { continue }
  Copy-Item -LiteralPath $path -Destination "$path.pre-migrate" -Force
  # Top-level key: insert before the first [section] (or append when there is none).
  $m = [regex]::Match($text, '(?m)^\s*\[')
  $text = if ($m.Success) { $text.Insert($m.Index, "tun = true`n") } else { $text.TrimEnd() + "`ntun = true`n" }
  [System.IO.File]::WriteAllText($path, $text, $utf8)
  $changed++
  Write-Output "migrated $path (whole-device on)"
}
Write-Output "migrate-daemon-config: $changed file(s) changed"
exit 0
