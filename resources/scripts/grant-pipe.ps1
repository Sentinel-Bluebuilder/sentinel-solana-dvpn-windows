# Let the app's Windows user reach the VPN service NOW, without signing out (owner 2026-11-12).
#
# dvpnd's pipe admits SYSTEM, Administrators and the sentinel-dvpn group. Windows puts a new group in
# a user's token only at the next sign-in, so right after the first install the app was locked out
# ("sign out and back in"). This adds the user's own SID, with the group's narrow rights, to the live
# pipe via pipe-bridge.exe -grant. That entry lives only on the live pipe, so -Persist 1 also lists the
# user in the service home's pipe-allow.txt, which dvpnd applies to every pipe it creates (Q0488); after
# the next sign-in the user also holds the group. Called ELEVATED: by setup-daemon.ps1 and
# apply-daemon-config.ps1 after they (re)start the service, and on its own by the app (one UAC prompt)
# when the link is refused. Takes only paths and an account name. ASCII only (PowerShell 5.1).
param(
  [Parameter(Mandatory = $true)][string]$Bridge,
  [Parameter(Mandatory = $true)][string]$User,
  [string]$Service = 'sentinel-dvpnd$c0',
  [string]$Result = '',
  # Also list the user in pipe-allow.txt, so dvpnd re-admits them on every pipe it creates (Q0488: a
  # crash or update restart made a fresh pipe without the entry, and the app was locked out again).
  [string]$Persist = ''
)
$ErrorActionPreference = 'Stop'

function Write-Result([string]$status, [string]$detail) {
  if (-not $Result) { return }
  $json = @{ status = $status; detail = $detail; at = (Get-Date).ToString('o') } | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText($Result, $json, (New-Object System.Text.UTF8Encoding($false)))
}

try {
  if ($Service -notmatch '^sentinel-dvpnd\$([a-z0-9]+)$') { throw "unexpected service name $Service" }
  $instance = $Matches[1]
  if ([System.IO.Path]::GetFileName($Bridge) -ne 'pipe-bridge.exe') { throw 'unexpected bridge binary name' }
  if (-not (Test-Path -LiteralPath $Bridge -PathType Leaf)) { throw "pipe-bridge not found at $Bridge" }
  # Runs elevated: the program must sit in an admin-only folder chain, like the service binary.
  # Dot-sourced inside a function so its parameters ($User, $Result, ...) cannot overwrite ours.
  function Test-BridgeFolder([string]$dir) {
    . (Join-Path $PSScriptRoot 'setup-daemon.ps1') -Dvpnd x -DaemonHome x -Result x
    Assert-AdminOnlyChain $dir
  }
  Test-BridgeFolder (Split-Path -Parent $Bridge)

  if ($User -match '^S-1-5-21-[0-9-]+$') { $sid = $User }
  else { $sid = ([System.Security.Principal.NTAccount]$User).Translate([System.Security.Principal.SecurityIdentifier]).Value }
  if ($sid -notmatch '^S-1-5-21-[0-9-]+$') { throw "not a user account: $User" }

  $svc = Get-Service -Name $Service -ErrorAction SilentlyContinue
  if (-not $svc) { throw 'the VPN service is not installed' }
  if ($svc.Status -ne 'Running') { $svc.WaitForStatus('Running', [TimeSpan]::FromSeconds(30)) }

  $pipe = "\\.\pipe\ProtectedPrefix\Administrators\sentinel-dvpn\$instance"
  # Right after a start the pipe may not exist yet: try for up to 30 s.
  $ErrorActionPreference = 'Continue'
  for ($i = 0; $i -lt 15; $i++) {
    $out = (& $Bridge -daemon $pipe -grant $sid 2>&1 | Out-String).Trim()
    $code = $LASTEXITCODE
    if ($code -eq 0) { break }
    Start-Sleep -Seconds 2
  }
  $ErrorActionPreference = 'Stop'
  if ($code -ne 0) { throw "grant failed: $out" }

  if ($Persist -eq '1') {
    # Q0488: dvpnd (fork final6.7) adds every user listed in <home>\pipe-allow.txt to the pipe each time it
    # creates it, so access survives a restart, a crash, an update and a reboot. The cd7e9d6 task on SCM
    # event 7036 never fired: Windows 11 does not log 7036. dvpnd ignores the file unless SYSTEM and
    # Administrators alone own and can change it, and takes only single user-account SIDs from it.
    $dhome = Join-Path $env:ProgramData "sentinel-dvpn\$instance"
    if (-not (Test-Path -LiteralPath $dhome -PathType Container)) { throw "service home not found: $dhome" }
    $allow = Join-Path $dhome 'pipe-allow.txt'
    $sids = @()
    if (Test-Path -LiteralPath $allow -PathType Leaf) {
      $sids = @(Get-Content -LiteralPath $allow | ForEach-Object { $_.Trim().ToUpper() } | Where-Object { $_ -match '^S-1-5-21-[0-9-]+$' })
    }
    $sids = @(@($sids) + $sid.ToUpper() | Select-Object -Unique)
    $tmp = "$allow.tmp"
    [System.IO.File]::WriteAllText($tmp, (($sids -join "`r`n") + "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
    # Owner Administrators; SYSTEM + Administrators only; inheritance off (the home folder gives Users read).
    $acl = New-Object System.Security.AccessControl.FileSecurity
    $acl.SetOwner((New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')))
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($s in 'S-1-5-18', 'S-1-5-32-544') {
      $who = New-Object System.Security.Principal.SecurityIdentifier($s)
      $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($who, 'FullControl', 'Allow')))
    }
    Set-Acl -LiteralPath $tmp -AclObject $acl
    Move-Item -LiteralPath $tmp -Destination $allow -Force   # a rename keeps the ACL just set
    Write-Output "access kept across service restarts: $($sids.Count) account(s) in pipe-allow.txt"

    # Upgrade from cd7e9d6: its per-user tasks never ran (no 7036 events); remove them.
    Get-ScheduledTask -TaskName 'devnet-dvpn-pipe-grant-*' -ErrorAction SilentlyContinue | ForEach-Object {
      Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false -ErrorAction Continue
      Write-Output "old task removed: $($_.TaskName)"
    }
  }
  Write-Result 'ok' "granted $sid"
  Write-Output "granted $sid"
  exit 0
} catch {
  Write-Result 'error' $_.Exception.Message
  Write-Error $_.Exception.Message -ErrorAction Continue
  exit 1
}
