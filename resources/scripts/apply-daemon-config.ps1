# Apply staged dvpnd config files and restart the service (decision D4).
#
# Run ELEVATED by the app (one UAC prompt). Takes only paths: the app wrote and
# validated the files in its own folder; this script never sees config text on
# its command line. It refuses anything but the expected file names (config.toml,
# v2ray/xray config.toml), keeps a
# backup, restarts the service, and rolls back if the service fails to start.
param(
  [Parameter(Mandatory = $true)][string]$Staged,
  [Parameter(Mandatory = $true)][string]$DaemonHome,
  [string]$Service = 'sentinel-dvpnd$c0',
  [string]$Result
)
$ErrorActionPreference = 'Stop'

function Write-Result([string]$status, [string]$detail) {
  if ($Result) {
    $json = @{ status = $status; detail = $detail; at = (Get-Date).ToString('o') } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($Result, $json, (New-Object System.Text.UTF8Encoding($false)))
  }
}

try {
  # cb33 layout: ONE instance config.toml; V2Ray/Xray in <home>\<service>\config.toml.
  $pairs = @(
    @{ src = Join-Path $Staged 'config.toml'; dst = Join-Path $DaemonHome 'config.toml' }
  )
  # Optional: V2Ray/Xray service configs (whole-device mode), only when staged AND installed.
  foreach ($s in 'v2ray', 'xray') {
    $src = Join-Path $Staged "$s.config.toml"
    $dst = Join-Path (Join-Path $DaemonHome $s) 'config.toml'
    if ((Test-Path -LiteralPath $src -PathType Leaf) -and (Test-Path -LiteralPath $dst -PathType Leaf)) { $pairs += @{ src = $src; dst = $dst } }
  }
  foreach ($p in $pairs) {
    if (-not (Test-Path -LiteralPath $p.src -PathType Leaf)) { throw "missing staged file $($p.src)" }
    if (-not (Test-Path -LiteralPath $p.dst -PathType Leaf)) { throw "daemon home has no $($p.dst)" }
    if ((Get-Item -LiteralPath $p.src).Length -gt 65536) { throw "staged file too large: $($p.src)" }
  }

  foreach ($p in $pairs) { Copy-Item -LiteralPath $p.dst -Destination "$($p.dst).bak" -Force }

  $svc = Get-Service -Name $Service -ErrorAction SilentlyContinue
  if ($svc -and $svc.Status -ne 'Stopped') {
    # The service reports Stopped before its process has exited; a new dvpnd started while the old
    # one still holds its files exits at once ("Incorrect function", test-host cli187). Wait for it.
    $oldPid = (Get-CimInstance Win32_Service -Filter "Name='$Service'").ProcessId
    Stop-Service -Name $Service -Force
    $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
    if ($oldPid) { Wait-Process -Id $oldPid -Timeout 30 -ErrorAction SilentlyContinue }
  }

  foreach ($p in $pairs) { Copy-Item -LiteralPath $p.src -Destination $p.dst -Force }
  # Re-apply the home lock: it also fixes homes set up before lock-daemon-home.ps1 existed.
  try {
    & (Join-Path $PSScriptRoot 'lock-daemon-home.ps1') -DaemonHome $DaemonHome | Out-Null
  } catch {
    Write-Warning "daemon home not locked: $($_.Exception.Message)"
  }

  if ($svc) {
    # Start, retrying a quick early exit; roll back only if the new settings never start.
    $lastErr = $null
    for ($try = 1; $try -le 3; $try++) {
      try {
        Start-Service -Name $Service
        (Get-Service -Name $Service).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
        Start-Sleep -Seconds 2
        if ((Get-Service -Name $Service).Status -eq 'Running') { $lastErr = $null; break }
        $lastErr = 'the service stopped right after starting'
      } catch {
        $lastErr = $_.Exception.Message
      }
      Start-Sleep -Seconds 3
    }
    if ($lastErr) {
      foreach ($p in $pairs) { Copy-Item -LiteralPath "$($p.dst).bak" -Destination $p.dst -Force }
      for ($try = 1; $try -le 3; $try++) {
        Start-Service -Name $Service -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 3
        if ((Get-Service -Name $Service).Status -eq 'Running') { break }
      }
      throw "service failed to start with the new settings; previous settings restored: $lastErr"
    }
  }
  Write-Result 'ok' ($(if ($svc) { 'applied and restarted' } else { 'applied (no service installed)' }))
  exit 0
} catch {
  Write-Result 'error' $_.Exception.Message
  exit 1
}
