# Pester cases for guard-app-folder.ps1 (rc9-f W-D-RACE). Run on Windows as an administrator (Windows testing on w11):
#   Invoke-Pester -Path resources\scripts\guard-app-folder.Tests.ps1
# Each case works under a fresh admin-only folder at the system drive root (it passes Assert-AdminOnlyChain).
# ASCII only.

BeforeAll {
  . (Join-Path $PSScriptRoot 'guard-app-folder.ps1') -Dir 'x'
  function New-Parent {
    $p = Join-Path $env:SystemDrive ('gaf-' + [guid]::NewGuid().ToString('N'))
    [void][System.IO.Directory]::CreateDirectory($p, (New-AppDirSecurity))
    return $p
  }
  # A folder a standard user made: owned by Users, Authenticated Users may modify it (what C:\ hands a new subfolder).
  function New-UserFolder([string]$p) {
    New-Item -ItemType Directory -Path $p | Out-Null
    icacls.exe $p /grant '*S-1-5-11:(OI)(CI)M' /Q | Out-Null
    icacls.exe $p /setowner '*S-1-5-32-545' /Q | Out-Null
  }
  function Get-OwnerSid([string]$p) { (Get-Acl -LiteralPath $p).GetOwner([System.Security.Principal.SecurityIdentifier]).Value }
  $script:parents = New-Object System.Collections.ArrayList
}

AfterAll {
  foreach ($p in $script:parents) {
    takeown.exe /F $p /R /D Y | Out-Null
    icacls.exe $p /grant '*S-1-5-32-544:(OI)(CI)F' /T /C /Q | Out-Null
    Remove-Item -LiteralPath $p -Recurse -Force
  }
}

Describe 'Invoke-AppFolderGuard (rc9-f W-D-RACE)' {
  BeforeEach { $script:parent = New-Parent; [void]$script:parents.Add($script:parent); $script:app = Join-Path $script:parent 'DevnetDVPN' }

  It 'a NON-EMPTY folder a standard user owns: refused (exit 2), the planted file and its owner untouched' {
    New-UserFolder $app
    Set-Content -LiteralPath (Join-Path $app 'install-deps.ps1') -Value 'planted' -Encoding ASCII
    $r = Invoke-AppFolderGuard -Dir $app
    $r.code | Should -Be 2
    $r.message | Should -Match 'already holds files'
    Get-Content -LiteralPath (Join-Path $app 'install-deps.ps1') | Should -Be 'planted'
    Get-OwnerSid $app | Should -Be 'S-1-5-32-545'
  }
  It 'non-empty, owned by Administrators but Authenticated Users may modify it: refused' {
    New-Item -ItemType Directory -Path $app | Out-Null
    icacls.exe $app /grant '*S-1-5-11:(OI)(CI)M' /Q | Out-Null
    Set-Content -LiteralPath (Join-Path $app 'x.dll') -Value 'planted' -Encoding ASCII
    (Invoke-AppFolderGuard -Dir $app).code | Should -Be 2
  }
  It 'an EMPTY folder a standard user owns: replaced by an admin-only one' {
    New-UserFolder $app
    (Invoke-AppFolderGuard -Dir $app).code | Should -Be 0
    Get-OwnerSid $app | Should -Be 'S-1-5-32-544'
    Get-AdminOnlyProblem $app | Should -BeNullOrEmpty
  }
  It 'rc9-f2: an EMPTY user folder that is this process''s current directory: still replaced (exit 0)' {
    New-UserFolder $app
    Push-Location -LiteralPath $app
    [System.IO.Directory]::SetCurrentDirectory($app)
    try {
      (Invoke-AppFolderGuard -Dir $app).code | Should -Be 0
      Get-OwnerSid $app | Should -Be 'S-1-5-32-544'
      Get-AdminOnlyProblem $app | Should -BeNullOrEmpty
    } finally {
      Pop-Location
      [System.IO.Directory]::SetCurrentDirectory($env:SystemRoot)
    }
  }
  It 'rc9-f2: absent at the customInit run, made by the installer (inherited user write, its cwd) before the unpack run: locked' {
    (Invoke-AppFolderGuard -Dir $app -NoCreate).code | Should -Be 0
    Test-Path -LiteralPath $app | Should -BeFalse
    New-Item -ItemType Directory -Path $app | Out-Null
    icacls.exe $app /grant '*S-1-5-11:(OI)(CI)M' /Q | Out-Null
    Push-Location -LiteralPath $app
    [System.IO.Directory]::SetCurrentDirectory($app)
    try {
      (Invoke-AppFolderGuard -Dir $app).code | Should -Be 0
      Get-OwnerSid $app | Should -Be 'S-1-5-32-544'
      Get-AdminOnlyProblem $app | Should -BeNullOrEmpty
    } finally {
      Pop-Location
      [System.IO.Directory]::SetCurrentDirectory($env:SystemRoot)
    }
  }
  It 'rc9-f2: a refusal leaves no weakened folder: an empty user folder another process holds open is locked, then refused' {
    New-UserFolder $app
    $holder = Start-Process -FilePath cmd.exe -ArgumentList '/c', 'ping -n 30 127.0.0.1 >nul' -WorkingDirectory $app -WindowStyle Hidden -PassThru
    try {
      Start-Sleep -Seconds 1
      $r = Invoke-AppFolderGuard -Dir $app
      $r.code | Should -Be 2
      $r.message | Should -Match 'locked to administrators and left empty'
      Get-AdminOnlyProblem $app | Should -BeNullOrEmpty
    } finally {
      Stop-Process -Id $holder.Id -Force
    }
  }
  It 'rc9-f3: guard and assert started from a folder holding a non-.NET System.dll (the installer cwd) still pass' {
    $cwd = Join-Path $parent 'cwd'
    New-Item -ItemType Directory -Path $cwd | Out-Null
    [System.IO.File]::WriteAllBytes((Join-Path $cwd 'System.dll'), [byte[]](0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00))
    $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $g = Start-Process -FilePath $ps -ArgumentList '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'guard-app-folder.ps1'), '-Dir', $app -WorkingDirectory $cwd -WindowStyle Hidden -Wait -PassThru
    $g.ExitCode | Should -Be 0
    $a = Start-Process -FilePath $ps -ArgumentList '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'assert-app-folder.ps1'), '-Dir', $app -WorkingDirectory $cwd -WindowStyle Hidden -Wait -PassThru
    $a.ExitCode | Should -Be 0
  }
  It 'not there: made admin-only and empty; with -NoCreate: left alone' {
    (Invoke-AppFolderGuard -Dir $app -NoCreate).code | Should -Be 0
    Test-Path -LiteralPath $app | Should -BeFalse
    (Invoke-AppFolderGuard -Dir $app).code | Should -Be 0
    Get-OwnerSid $app | Should -Be 'S-1-5-32-544'
    Get-AdminOnlyProblem $app | Should -BeNullOrEmpty
    Test-DirEmpty $app | Should -BeTrue
  }
  It 'an update: an admin-only folder with the app in it is kept' {
    [void][System.IO.Directory]::CreateDirectory($app, (New-AppDirSecurity))
    Set-Content -LiteralPath (Join-Path $app 'keep.txt') -Value 'keep' -Encoding ASCII
    (Invoke-AppFolderGuard -Dir $app).code | Should -Be 0
    Get-Content -LiteralPath (Join-Path $app 'keep.txt') | Should -Be 'keep'
  }
  It 'a junction at the folder: refused' {
    $target = Join-Path $parent 'elsewhere'; New-Item -ItemType Directory -Path $target | Out-Null
    New-Item -ItemType Junction -Path $app -Target $target | Out-Null
    (Invoke-AppFolderGuard -Dir $app).code | Should -Be 2
  }
  It 'a parent a standard user can change: refused, nothing made' {
    $userParent = Join-Path $parent 'mine'; New-UserFolder $userParent
    $inside = Join-Path $userParent 'DevnetDVPN'
    (Invoke-AppFolderGuard -Dir $inside).code | Should -Be 2
    Test-Path -LiteralPath $inside | Should -BeFalse
  }
  It 'a parent that does not exist: refused' {
    (Invoke-AppFolderGuard -Dir (Join-Path $parent 'no\DevnetDVPN')).code | Should -Be 2
  }
  It 'Program Files (here a stand-in root): nothing checked or changed' {
    New-UserFolder $app
    Set-Content -LiteralPath (Join-Path $app 'x.txt') -Value 'x' -Encoding ASCII
    (Invoke-AppFolderGuard -Dir $app -ProgramFiles64 $parent).code | Should -Be 0
    Get-OwnerSid $app | Should -Be 'S-1-5-32-545'
  }
}
