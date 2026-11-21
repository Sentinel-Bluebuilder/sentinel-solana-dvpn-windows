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
  [string]$Result,
  # Re-grant the app user the pipe after the restart (grant-pipe.ps1); both empty = skip.
  [string]$Bridge = '',
  [string]$User = ''
)
$ErrorActionPreference = 'Stop'
# rc9-c D1-D3 (staging-guard.ps1): the staged folder is checked and read once into an admin-only snapshot.
. (Join-Path $PSScriptRoot 'staging-guard.ps1')
$snap = ''

function Write-Result([string]$status, [string]$detail) {
  if ($Result) {
    $json = @{ status = $status; detail = $detail; at = (Get-Date).ToString('o') } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($Result, $json, (New-Object System.Text.UTF8Encoding($false)))
  }
}

# Q0544 (Windows): never overwrite a live config in place. A copy cut by power loss / a VM preemption left
# config.toml empty or half-written. Write <dst>.new in the same folder, flush it to disk, then swap it in
# with ReplaceFile (atomic on one NTFS volume; keeps dst's ACL). dst is always a file that exists here.
function Install-FileAtomic([string]$From, [string]$To) {
  $tmp = "$To.new"
  Copy-Item -LiteralPath $From -Destination $tmp -Force
  $fs = [System.IO.File]::Open($tmp, 'Open', 'ReadWrite', 'None')
  try { $fs.Flush($true) } finally { $fs.Dispose() }
  try {
    [System.IO.File]::Replace($tmp, $To, [NullString]::Value)
  } catch {
    Write-Warning "atomic replace of $To failed ($($_.Exception.Message)); moving instead"
    Move-Item -LiteralPath $tmp -Destination $To -Force
  }
}

try {
  # rc9-c D2/D3: each expected file is read ONCE, links refused, into $snap; every check, the copy and the rollback
  # below read the snapshot (the user owns the staged folder for the whole 30 s service stop).
  # rc9-c D5: only this app's service (the grant-pipe.ps1 check).
  if ($Service -notmatch '^sentinel-dvpnd\$([a-z0-9]+)$') { throw "unexpected service name $Service" }
  $Staged = Assert-StagingPath $Staged @('staged')
  $snap = New-StagingSnapshotDir
  foreach ($n in @('config.toml', 'v2ray.config.toml', 'xray.config.toml')) {
    $f = Join-Path $Staged $n
    if (Test-Path -LiteralPath $f) { Copy-StagedFile $f (Join-Path $snap $n) 65536 }
  }
  $Staged = $snap
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
    # one still holds its files exits at once ("Incorrect function", ddv-win-2 cli187). Wait for it.
    $oldPid = (Get-CimInstance Win32_Service -Filter "Name='$Service'").ProcessId
    Stop-Service -Name $Service -Force
    $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
    if ($oldPid) { Wait-Process -Id $oldPid -Timeout 30 -ErrorAction SilentlyContinue }
  }

  foreach ($p in $pairs) { Install-FileAtomic $p.src $p.dst }
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
      foreach ($p in $pairs) { Install-FileAtomic "$($p.dst).bak" $p.dst }
      for ($try = 1; $try -le 3; $try++) {
        Start-Service -Name $Service -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 3
        if ((Get-Service -Name $Service).Status -eq 'Running') { break }
      }
      throw "service failed to start with the new settings; previous settings restored: $lastErr"
    }
  }
  # The restart dropped any direct pipe grant; a user not yet signed in again needs it back.
  if ($svc -and $Bridge -and $User) {
    try {
      & (Join-Path $PSScriptRoot 'grant-pipe.ps1') -Bridge $Bridge -User $User -Service $Service | Out-Null
    } catch {
      Write-Warning "pipe grant failed: $($_.Exception.Message)"
    }
  }
  Remove-StagingTree $snap
  Write-Result 'ok' ($(if ($svc) { 'applied and restarted' } else { 'applied (no service installed)' }))
  exit 0
} catch {
  if ($snap) { Remove-StagingTree $snap }
  Write-Result 'error' $_.Exception.Message
  exit 1
}
