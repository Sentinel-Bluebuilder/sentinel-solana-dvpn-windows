# R1b (rc9-d, Windows testing w11): the installer VERIFIES the app folder after locking it, instead of trusting icacls' exit
# codes (the combined call exited 0 and left Authenticated Users:Modify plus empty file DACLs). Run from $PLUGINSDIR
# next to a copy of setup-daemon.ps1. Exit 0 = the folder is owned and writable only by administrators (setup-daemon's
# Assert-AdminOnly), every file and folder under it is too (rc9-f W-WIN-11) and still grants SYSTEM access; exit 1 = refused, with the reason.
param([Parameter(Mandatory = $true)][string]$Dir)
# rc9-f3 (Windows testing live): never compile or load from the caller's current directory. The installer starts this from
# a folder that may hold NSIS's 32-bit System.dll, and Add-Type's csc resolves System.dll from the cwd first.
Set-Location -LiteralPath $env:SystemRoot
[System.IO.Directory]::SetCurrentDirectory($env:SystemRoot)
$ErrorActionPreference = 'Stop'
try {
  . (Join-Path $PSScriptRoot 'setup-daemon.ps1') -Dvpnd 'x' -DaemonHome 'y' -Result 'z'
  Assert-AdminOnly $Dir
  foreach ($item in Get-ChildItem -LiteralPath $Dir -Recurse -Force) {
    # rc9-f W-WIN-11: every file and folder under it is owned and writable only by administrators too (a child a
    # standard user can still write would let them replace a program the service runs as SYSTEM).
    Assert-AdminOnly $item.FullName
    $acl = Get-Acl -LiteralPath $item.FullName
    $system = $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) |
      Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -eq 'S-1-5-18' }
    if (-not $system) { throw "$($item.FullName) has no access for SYSTEM (an empty or broken ACL)" }
  }
  Write-Output "app folder verified: $Dir"
  exit 0
} catch {
  Write-Output "app folder refused: $($_.Exception.Message)"
  exit 1
}
