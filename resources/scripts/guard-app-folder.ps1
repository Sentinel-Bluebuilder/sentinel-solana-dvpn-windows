# rc9-f W-D-RACE (Windows testing audit, H): lock the app folder BEFORE the installer writes a file into it.
# R1/R1b locked it in customInstall, i.e. after the ~60 s unpack. A folder a standard user made beforehand
# (/D=C:\DevnetDVPN) kept files planted in it, and its owner could swap install-deps.ps1 or sentinel-dvpnd.exe during
# the unpack; customInstall then ran them elevated (LPE to SYSTEM).
# The installer embeds this file (and the ones it dot-sources) and runs it from $PLUGINSDIR in customInit (-NoCreate)
# and again in customUnInstallCheck: after an update's old uninstaller (which removes the folder) and right before
# electron-builder's SetOutPath + unpack.
#   Program Files: nothing to do (the folder inherits the admin-only Program Files rule).
#   Elsewhere: every parent must be admin-only (setup-daemon's Assert-AdminOnlyChain: a parent a user controls lets
#   them rename the app folder away and put their own in its place). An existing folder owned and writable only by
#   administrators is kept (an update). Any other existing folder is refused unless it is empty; an empty one is
#   removed and made again. A new folder is made WITH its admin-only ACL (no moment where a user can open it), then
#   read back: owner Administrators, admin-only, not a link, empty. Then the owner + the 4 icacls calls of customInstall.
# -NoCreate: a folder that does not exist yet is left for the unpack-time run.
# Exit 0 = locked (or Program Files, or -NoCreate and not there); exit 2 = refused, the reason on stdout.
# ASCII only (PowerShell 5.1 reads cp1252).
param(
  [Parameter(Mandatory = $true)][string]$Dir,
  [string]$ProgramFiles64 = '',
  [string]$ProgramFiles32 = '',
  [switch]$NoCreate
)
$ErrorActionPreference = 'Stop'
# rc9-f2: the installer may start this with the app folder as the current directory.
Set-Location -LiteralPath $env:SystemRoot
[System.IO.Directory]::SetCurrentDirectory($env:SystemRoot)
. (Join-Path $PSScriptRoot 'setup-daemon.ps1') -Dvpnd 'x' -DaemonHome 'y' -Result 'z'

function Test-UnderRoot([string]$full, [string]$root) {
  if (-not $root) { return $false }
  $r = [System.IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
  return ($full + '\').StartsWith($r, [System.StringComparison]::OrdinalIgnoreCase)
}

# Owner Administrators; protected (nothing inherited from C:\); SYSTEM + Administrators full, Users read: the
# customInstall icacls result, set at creation.
function New-AppDirSecurity {
  $s = New-Object System.Security.AccessControl.DirectorySecurity
  $s.SetOwner((New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')))
  $s.SetAccessRuleProtection($true, $false)
  $inh = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
  $none = [System.Security.AccessControl.PropagationFlags]::None
  foreach ($p in @(@('S-1-5-18', 'FullControl'), @('S-1-5-32-544', 'FullControl'), @('S-1-5-32-545', 'ReadAndExecute'))) {
    $sid = New-Object System.Security.Principal.SecurityIdentifier($p[0])
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, [System.Security.AccessControl.FileSystemRights]$p[1], $inh, $none, 'Allow')
    $s.AddAccessRule($rule)
  }
  return $s
}

function Test-DirEmpty([string]$p) {
  return ($null -eq (Get-ChildItem -LiteralPath $p -Force | Select-Object -First 1))
}

function Test-IsLink([string]$p) {
  return ((Get-Item -LiteralPath $p -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
}

# $null when the folder is owned and writable only by administrators, else the reason (setup-daemon's Assert-AdminOnly).
function Get-AdminOnlyProblem([string]$p) {
  try { Assert-AdminOnly $p; return $null } catch { return $_.Exception.Message }
}

# The owner + the 4 icacls calls of customInstall (+ /reset of any children). $null when done, else the reason.
function Invoke-AppDirLock([string]$full) {
  $calls = @(
    @($full, '/setowner', '*S-1-5-32-544', '/T', '/C', '/Q'),
    @($full, '/grant:r', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '*S-1-5-32-545:(OI)(CI)RX', '/Q'),
    @($full, '/inheritance:r', '/Q'),
    @($full, '/remove:g', '*S-1-1-0', '*S-1-5-11', '/Q')
  )
  foreach ($c in $calls) {
    & icacls.exe @c | Out-Null
    if ($LASTEXITCODE -ne 0) { return "icacls $($c[1]) exit $LASTEXITCODE" }
  }
  if (-not (Test-DirEmpty $full)) {
    & icacls.exe "$full\*" /reset /T /C /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { return "icacls /reset exit $LASTEXITCODE" }
  }
  return $null
}

function Invoke-AppFolderGuard([string]$Dir, [string]$ProgramFiles64 = '', [string]$ProgramFiles32 = '', [switch]$NoCreate) {
  # rc9-f2: never hold the app folder as a current directory (an empty untrusted folder is removed below).
  Set-Location -LiteralPath $env:SystemRoot
  [System.IO.Directory]::SetCurrentDirectory($env:SystemRoot)
  $full = [System.IO.Path]::GetFullPath($Dir).TrimEnd('\')
  if ((Test-UnderRoot $full $ProgramFiles64) -or (Test-UnderRoot $full $ProgramFiles32)) {
    return @{ code = 0; message = "app folder in Program Files: $full" }
  }
  $parent = Split-Path -Parent $full
  if (-not $parent -or -not (Test-Path -LiteralPath $parent -PathType Container)) {
    return @{ code = 2; message = "The folder $full was not used: its parent folder does not exist. Make it as an administrator first, or install into Program Files. Nothing was changed." }
  }
  try { Assert-AdminOnlyChain $parent } catch {
    return @{ code = 2; message = "The folder $full was not used: a folder above it can be changed by a standard user ($($_.Exception.Message)). Install into Program Files. Nothing was changed." }
  }
  $exists = Test-Path -LiteralPath $full
  if ($exists) {
    if (-not (Test-Path -LiteralPath $full -PathType Container)) {
      return @{ code = 2; message = "The folder $full was not used: it is a file. Nothing was changed." }
    }
    if (Test-IsLink $full) {
      return @{ code = 2; message = "The folder $full was not used: it is a link (junction or symbolic link). Nothing was changed." }
    }
    $problem = Get-AdminOnlyProblem $full
    if ($problem) {
      if (-not (Test-DirEmpty $full)) {
        return @{ code = 2; message = "The folder $full was not used: it already holds files and a standard user can change it ($problem). Empty it, or install into Program Files. Nothing was changed." }
      }
      # Empty but a user's: never trusted (they may hold a handle to it). Removed and made again below.
      try { Remove-Item -LiteralPath $full -Force } catch {
        # rc9-f2: a refusal never leaves a weakened folder behind: the empty one is locked to administrators.
        $why = $_.Exception.Message
        $lock = Invoke-AppDirLock $full
        $left = if ($lock) { "locking it failed too ($lock)" } else { 'it was locked to administrators and left empty' }
        return @{ code = 2; message = "The folder $full was not used: a standard user can change it and it could not be replaced ($why); $left. Nothing was installed." }
      }
      $exists = $false
    }
  }
  if (-not $exists) {
    if ($NoCreate) { return @{ code = 0; message = "app folder not made yet: $full" } }
    try { [void][System.IO.Directory]::CreateDirectory($full, (New-AppDirSecurity)) } catch {
      return @{ code = 2; message = "The folder $full could not be made ($($_.Exception.Message)). Nothing was installed." }
    }
    # CreateDirectory returns an existing folder as it is: one a user made at the same moment fails here.
    $problem = Get-AdminOnlyProblem $full
    if ($problem -or (Test-IsLink $full) -or -not (Test-DirEmpty $full)) {
      return @{ code = 2; message = "The folder $full is not the one this installer made ($problem). Nothing was installed." }
    }
  }
  $lock = Invoke-AppDirLock $full
  if ($lock) { return @{ code = 2; message = "The folder $full could not be locked to administrators ($lock). Nothing was installed." } }
  return @{ code = 0; message = "app folder locked to administrators: $full" }
}

# Dot-sourcing (the Pester test) stops here with the functions defined.
if ($MyInvocation.InvocationName -eq '.') { return }

try {
  $r = Invoke-AppFolderGuard -Dir $Dir -ProgramFiles64 $ProgramFiles64 -ProgramFiles32 $ProgramFiles32 -NoCreate:$NoCreate
} catch {
  $r = @{ code = 2; message = "The app folder check failed: $($_.Exception.Message). Nothing was installed." }
}
Write-Output $r.message
exit $r.code
