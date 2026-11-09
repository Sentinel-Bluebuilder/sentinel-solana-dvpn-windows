# Install the VPN service (sentinel-dvpnd$c0) on its cb33 instance home (F1.5).
#
# Order matters: the daemon refuses to start until its device key holds a grant, so
# the app first runs `sentinel-dvpnd init --instance c0 --home <staging>` UNELEVATED
# into a per-user staging folder, the owner signs device setup, and only then this
# script runs ELEVATED (one UAC prompt) to: copy the home into ProgramData, install
# the service (cb33 `service install` makes the sentinel-dvpn group and resets the
# instance folder to SYSTEM + Administrators), lock the home, give the user the
# pipe group, start the service, and delete the staging copy (it holds the device
# secret). -Staging '' = the home is already in place (an update ran `daemon migrate`).
# Takes only paths, each checked here. ASCII only (PowerShell 5.1 reads cp1252).
param(
  [Parameter(Mandatory = $true)][string]$Dvpnd,
  [string]$Staging = '',
  [Parameter(Mandatory = $true)][string]$DaemonHome,
  [Parameter(Mandatory = $true)][string]$Result,
  [string]$Service = 'sentinel-dvpnd$c0',
  # The app's bin folder; its v2ray\, xray\ and hysteria2\ subfolders are the SERVICE's PATH (with System32)
  [string]$BinRoot = '',
  # The Windows account that uses the app (DOMAIN\name). Empty = the signed-in console user.
  [string]$User = ''
)
$ErrorActionPreference = 'Stop'
$instance = 'c0'
$group = 'sentinel-dvpn'

function Write-Result([string]$status, [string]$detail) {
  $json = @{ status = $status; detail = $detail; at = (Get-Date).ToString('o') } | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText($Result, $json, (New-Object System.Text.UTF8Encoding($false)))
}

# The service runs these programs as SYSTEM: a folder a standard user can write would let that user
# replace one -- and a user-writable ANCESTOR is just as dangerous, because the user can rename the
# admin-only folder out of the way and drop a look-alike in its place. So every directory from the
# binary's folder up to the volume root must be writable only by SYSTEM, Administrators,
# TrustedInstaller or CREATOR OWNER. Assert-AdminOnlyChain walks that chain; the volume root gets the
# one documented exception below.
$script:AdminSids = @('S-1-5-18', 'S-1-5-32-544', 'S-1-3-0', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
# Rights that let a principal add, replace or relink content in THIS folder.
$script:WriteRights = [System.Security.AccessControl.FileSystemRights]'WriteData, AppendData, WriteExtendedAttributes, WriteAttributes, Delete, DeleteSubdirectoriesAndFiles, ChangePermissions, TakeOwnership'
# Rights that let a principal delete, rename or relink a CHILD of this folder (swap the leaf from above).
$script:SwapRights = [System.Security.AccessControl.FileSystemRights]'Delete, DeleteSubdirectoriesAndFiles, ChangePermissions, TakeOwnership'
# Windows' stock volume-root ACL grants Users (S-1-5-32-545) and Authenticated Users (S-1-5-11)
# "create folder / append data" on the root itself. That only lets them make NEW items under the root;
# it does NOT let them delete or rename the existing admin-owned install folder (they hold no
# Delete / DeleteSubdirectoriesAndFiles), and the root itself cannot be renamed or swapped. So at the
# volume root -- and ONLY there -- we tolerate those two SIDs holding create/append rights, while still
# refusing anyone (them included) the swap rights above. Any deeper level stays strict.
$script:StockRootSids = @('S-1-5-32-545', 'S-1-5-11')

function Assert-AdminOnly([string]$dir, [switch]$TolerateStockRoot) {
  $acl = Get-Acl -LiteralPath $dir
  foreach ($r in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
    if ($r.AccessControlType -ne 'Allow') { continue }
    # An inherit-only ACE does not apply to THIS folder, only to its children. The chain walk judges
    # each child at its own level, where any inherited right shows up as an effective (non-inherit-only)
    # ACE; so skipping it here loses nothing. It stops the stock C:\ "Authenticated Users, subfolders
    # and files only" ACE (whose mask includes Delete) from being misread as a swap right on C:\ itself.
    if (($r.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
    $sid = $r.IdentityReference.Value
    if ($AdminSids -contains $sid) { continue }
    $mask = $WriteRights
    if ($TolerateStockRoot -and ($StockRootSids -contains $sid)) { $mask = $SwapRights }
    if (($r.FileSystemRights -band $mask) -ne 0) {
      throw "the app folder $dir can be changed by $sid; reinstall the app into Program Files"
    }
  }
}

# Walk from the binary's folder up to the volume root; every level must be admin-only. The volume root
# is checked with the stock-root exception documented above (its default create-ACE is not a swap vector).
function Assert-AdminOnlyChain([string]$leaf) {
  $cur = [System.IO.Path]::GetFullPath($leaf)
  while ($cur) {
    $parent = Split-Path -Parent $cur
    $isRoot = [string]::IsNullOrEmpty($parent)
    Assert-AdminOnly $cur -TolerateStockRoot:$isRoot
    if ($isRoot) { break }
    $cur = $parent
  }
}

# Dot-sourcing (the Pester test) stops here with the functions defined; a real elevated run continues.
if ($MyInvocation.InvocationName -eq '.') { return }

try {
  if (-not (Test-Path -LiteralPath $Dvpnd -PathType Leaf)) { throw "sentinel-dvpnd not found at $Dvpnd" }
  if ([System.IO.Path]::GetFileName($Dvpnd) -ne 'sentinel-dvpnd.exe') { throw 'unexpected daemon binary name' }
  $want = Join-Path $env:ProgramData "sentinel-dvpn\$instance"
  if ($DaemonHome.TrimEnd('\') -ne $want) { throw "daemon home must be $want (cb33 grants its pipe group only there)" }
  $binDir = Split-Path -Parent $Dvpnd
  Assert-AdminOnlyChain $binDir
  if ($BinRoot) { Assert-AdminOnlyChain $BinRoot }

  $homeHas = Test-Path -LiteralPath (Join-Path $DaemonHome 'config.toml') -PathType Leaf
  $stagedHas = $Staging -and (Test-Path -LiteralPath (Join-Path $Staging 'config.toml') -PathType Leaf)
  if (-not $homeHas -and -not $stagedHas) { throw "no config.toml in the staging home ($Staging) or the service home ($DaemonHome)" }
  if ($homeHas -and $stagedHas) {
    # A new device for a NEW owner (the user switched wallets): the staged home holds the key the
    # owner just granted. Installing nothing and then deleting the staging copy destroyed that key
    # (test-host 2026-10-24: grant + fee SOL stranded on a key that no longer existed, while the
    # service kept the old device). Same key = a re-run: keep the installed home.
    $keyOf = { param($h) $rows = (& $Dvpnd key list --instance c0 --home $h 2>$null | Out-String); if ($rows -match '\[') { ($rows.Substring($rows.IndexOf('[')) | ConvertFrom-Json) | Where-Object { $_.name -eq 'operator' } | ForEach-Object { $_.public_key } | Select-Object -First 1 } }
    $old = & $keyOf $DaemonHome
    $new = & $keyOf $Staging
    if (-not $new) { throw "staged home has no readable device key: $Staging" }
    if ($old -ne $new) {
      $svc0 = Get-Service -Name $Service -ErrorAction SilentlyContinue
      if ($svc0 -and $svc0.Status -ne 'Stopped') {
        $oldPid = (Get-CimInstance Win32_Service -Filter "Name='$Service'").ProcessId
        Stop-Service -Name $Service -Force
        $svc0.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
        if ($oldPid) { Wait-Process -Id $oldPid -Timeout 30 -ErrorAction SilentlyContinue }
      }
      # Kept, never deleted: the old device may still have deposits to settle.
      $prev = "$DaemonHome.prev-" + (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss')
      Move-Item -LiteralPath $DaemonHome -Destination $prev
      & (Join-Path $PSScriptRoot 'lock-daemon-home.ps1') -DaemonHome $prev | Out-Null
      $homeHas = $false
    }
  }
  if (-not $homeHas) {
    New-Item -ItemType Directory -Force -Path $DaemonHome | Out-Null
    Copy-Item -Path (Join-Path $Staging '*') -Destination $DaemonHome -Recurse -Force
  }
  & (Join-Path $PSScriptRoot 'migrate-daemon-config.ps1') -DaemonHome $DaemonHome | Out-Null

  $svc = Get-Service -Name $Service -ErrorAction SilentlyContinue
  if (-not $svc) {
    # No --home: cb33 grants its pipe group only for the instance's own folder (config.AccessGroup).
    $out = & $Dvpnd service install --instance $instance 2>&1
    if ($LASTEXITCODE -ne 0) { throw "service install failed: $out" }
  }
  # After `service install`: it resets the instance folder to SYSTEM + Administrators. Device key and
  # session credentials stay admin-only; the user may read config.toml (Settings) (lock-daemon-home.ps1).
  & (Join-Path $PSScriptRoot 'lock-daemon-home.ps1') -DaemonHome $DaemonHome | Out-Null

  # Plain automatic start failed on EVERY boot of the GCP VM (3 of 3, 2026-10-21): Windows gave
  # up after 45 s waiting for the unsigned daemon to connect (event 7009) while the rest of boot
  # was still loading, and the restart actions do not cover a start timeout. Delayed start (about
  # 2 min after boot) came up on its own (UPSTREAM-GAPS the Android app). Also restart on any non-crash failure.
  & sc.exe config $Service start= delayed-auto | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'could not set the service to delayed automatic start' }
  & sc.exe failureflag $Service 1 | Out-Null
  & (Join-Path $PSScriptRoot 'service-user-start.ps1') -Service $Service

  # The pipe admits SYSTEM, Administrators and the sentinel-dvpn group (rights 0x120183, which is
  # why pipe-bridge.exe stays). Windows reads group membership at sign-in: a user added now reaches
  # the service only after signing out and back in once (cb33: "effective at next login").
  if (-not $User) { $User = (Get-CimInstance Win32_ComputerSystem).UserName }
  $relogin = $false
  if ($User) {
    # PowerShell 5.1 with EAP Stop turns net.exe's stderr line into a terminating error, so "already a member"
    # (1378: a second daemon install, reinstall or repair) threw before the 1378 check below (QA 11-09).
    $ErrorActionPreference = 'Continue'
    $add = (& net.exe localgroup $group $User /add 2>&1 | Out-String)
    $addCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($addCode -eq 0) { $relogin = $true }
    elseif ($add -notmatch '1378') { throw "could not add $User to the $group group: $($add.Trim())" }
  } else {
    Write-Warning "no signed-in user found; add one with: net localgroup $group <user> /add"
  }

  # The daemon looks protocol programs up by name on its PATH. Only our own folders and the Windows
  # system folders go there: a folder from the machine PATH that a user can write would let that user
  # run a program as SYSTEM. A per-service Environment value; the machine PATH is left alone.
  $dirs = @()
  if ($BinRoot) { $dirs = @('v2ray', 'xray', 'hysteria2' | ForEach-Object { Join-Path $BinRoot $_ } | Where-Object { Test-Path -LiteralPath $_ -PathType Container }) }
  $sys = $env:SystemRoot
  $svcPath = ($dirs + @("$sys\System32", $sys, "$sys\System32\Wbem", "$sys\System32\WindowsPowerShell\v1.0")) -join ';'
  $svcKey = "HKLM:\SYSTEM\CurrentControlSet\Services\$Service"
  $had = (Get-ItemProperty -Path $svcKey -Name Environment -ErrorAction SilentlyContinue).Environment
  New-ItemProperty -Path $svcKey -Name Environment -PropertyType MultiString -Value @("PATH=$svcPath") -Force | Out-Null
  if ((($had | Out-String).Trim() -ne "PATH=$svcPath") -and (Get-Service -Name $Service).Status -eq 'Running') {
    # Restart so a running service picks the PATH up. Wait for the old process to exit: a daemon
    # started while it still runs exits at once.
    $oldPid = (Get-CimInstance Win32_Service -Filter "Name='$Service'").ProcessId
    Stop-Service -Name $Service -Force
    (Get-Service -Name $Service).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
    if ($oldPid) { Wait-Process -Id $oldPid -Timeout 30 -ErrorAction SilentlyContinue }
  }
  for ($try = 1; $try -le 3 -and (Get-Service -Name $Service).Status -ne 'Running'; $try++) {
    try {
      Start-Service -Name $Service
      (Get-Service -Name $Service).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
    } catch {
      if ($try -eq 3) { throw }
      Start-Sleep -Seconds 3
    }
  }
  # The first start after a reinstall ran with kill_switch 'on' (uninstall stepped persist down), so
  # the daemon released the old block row; from now on migrate-daemon-config.ps1 moves 'on' to 'persist'.
  $ksMark = Join-Path $DaemonHome '.ks-stepped-down'
  if (Test-Path -LiteralPath $ksMark) { Remove-Item -LiteralPath $ksMark -Force }
  if ($Staging -and (Test-Path -LiteralPath $Staging)) { Remove-Item -LiteralPath $Staging -Recurse -Force }
  Write-Result 'ok' ($(if ($relogin) { 'service installed and running; relogin-needed' } else { 'service installed and running' }))
  exit 0
} catch {
  Write-Result 'error' $_.Exception.Message
  exit 1
}
