# Pester tests for setup-daemon.ps1's admin-only ACL guard (F1.5 / fleet-security #34 ancestor walk).
# Runs on a Windows VM, no elevation needed (Pester 5/6):
#   Invoke-Pester -Path resources\scripts\setup-daemon.Tests.ps1
# The BeforeAll dot-sources setup-daemon.ps1 with dummy required params; the script's dot-source guard
# defines the functions and returns before any install work, so nothing touches a service, key folder or
# binary. Dot-sourcing and the helper live in BeforeAll (not at file top) so they are defined during
# Pester 5/6's run phase and are in scope inside the It blocks. ASCII only (PowerShell 5.1 reads cp1252).

BeforeAll {
  . (Join-Path $PSScriptRoot 'setup-daemon.ps1') -Dvpnd 'x' -DaemonHome 'y' -Result 'z'

  function New-AdminOnlyDir([string]$path) {
    # Lock a directory we own down to SYSTEM + Administrators only (owner can rewrite its DACL without elevation).
    New-Item -ItemType Directory -Path $path -Force | Out-Null
    $acl = Get-Acl -LiteralPath $path
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($ace in @($acl.Access)) { [void]$acl.RemoveAccessRule($ace) }
    foreach ($s in 'S-1-5-18', 'S-1-5-32-544') {
      $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        (New-Object System.Security.Principal.SecurityIdentifier($s)),
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        ([System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'),
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow)
      $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $path -AclObject $acl
  }
}

Describe 'Assert-AdminOnlyChain' {

  It 'passes a chain that is admin-only all the way to the volume root' {
    # C:\ -> C:\Windows -> C:\Windows\System32: every level admin-only; the root's stock create-ACE is tolerated.
    { Assert-AdminOnlyChain (Join-Path $env:SystemRoot 'System32') } | Should -Not -Throw
  }

  It 'refuses a leaf whose own folder is user-writable' {
    $leaf = Join-Path ([System.IO.Path]::GetTempPath()) ('ddv-acl-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $leaf -Force | Out-Null
    try {
      { Assert-AdminOnlyChain $leaf } | Should -Throw -ExpectedMessage '*reinstall the app into Program Files*'
    } finally {
      Remove-Item -LiteralPath $leaf -Recurse -Force -ErrorAction SilentlyContinue
    }
  }

  It 'refuses an admin-only leaf that sits under a user-writable ANCESTOR (the swap vector)' {
    # The old single-level check passed this (the leaf itself is locked down); the chain walk must still
    # refuse it, because the user-writable parent lets a standard user rename the leaf and drop a look-alike.
    $parent = Join-Path ([System.IO.Path]::GetTempPath()) ('ddv-acl-' + [guid]::NewGuid().ToString('N'))
    $leaf = Join-Path $parent 'bin'
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    New-AdminOnlyDir $leaf
    try {
      # Leaf alone is clean...
      { Assert-AdminOnly $leaf } | Should -Not -Throw
      # ...but the chain fails, and the refusal names the user-writable ancestor, not the leaf.
      $err = $null
      try { Assert-AdminOnlyChain $leaf } catch { $err = $_.Exception.Message }
      $err | Should -Not -BeNullOrEmpty
      $err | Should -BeLike "*$parent*"
      $err | Should -BeLike '*reinstall the app into Program Files*'
    } finally {
      Remove-Item -LiteralPath $parent -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

# rc9-c OWNER-SYNC (Windows testing w11): same device key, another wallet; only the root owner line changes.
Describe 'Update-ConfigOwner' {
  It 'rewrites the root owner, keeps its quote style and every other line' {
    $t = "owner = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'`nnetwork = 'devnet'`n[client]`nowner = 'keep'`n"
    $r = Update-ConfigOwner $t 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    $r.old | Should -Be 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    $r.text | Should -Be "owner = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'`nnetwork = 'devnet'`n[client]`nowner = 'keep'`n"
  }
  It 'returns nothing when the owner already matches' {
    Update-ConfigOwner "owner = `"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB`"`n" 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' | Should -BeNullOrEmpty
  }
  It 'throws when there is no root owner line' {
    { Update-ConfigOwner "[client]`nowner = 'x'`n" 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' } | Should -Throw
  }
}

# R1 (rc9-c2, macOS testing audit): a folder owned by a standard account is refused whatever its ACEs say.
Describe 'Test-AdminOwner / Assert-AdminOnly owner' {
  It 'admin SIDs own; Users, Authenticated Users and a user SID do not' {
    Test-AdminOwner 'S-1-5-18' | Should -BeTrue
    Test-AdminOwner 'S-1-5-32-544' | Should -BeTrue
    Test-AdminOwner 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464' | Should -BeTrue
    Test-AdminOwner 'S-1-5-32-545' | Should -BeFalse
    Test-AdminOwner 'S-1-5-11' | Should -BeFalse
    Test-AdminOwner 'S-1-5-21-111-222-333-1001' | Should -BeFalse
  }
  It 'an admin-only folder owned by the current (non-admin-SID) account is refused' {
    $dir = Join-Path $env:TEMP ('own-' + [guid]::NewGuid().ToString('N'))
    New-AdminOnlyDir $dir
    $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = Get-Acl -LiteralPath $dir
    $acl.SetOwner($me)
    Set-Acl -LiteralPath $dir -AclObject $acl
    if (Test-AdminOwner $me.Value) { Set-ItResult -Skipped -Because 'running as SYSTEM: this account is an admin SID' ; return }
    { Assert-AdminOnly $dir } | Should -Throw -ExpectedMessage '*is owned by*'
  }
}

Describe 'rc9-f2: the daemon binary itself is admin-only (not only its folder)' {
  It 'a user-writable exe in an admin-only folder is refused' {
    $dir = Join-Path $env:TEMP ('sd-exe-' + [guid]::NewGuid().ToString('N'))
    New-AdminOnlyDir $dir
    $exe = Join-Path $dir 'sentinel-dvpnd.exe'
    Set-Content -LiteralPath $exe -Value 'x' -Encoding ASCII
    icacls.exe $exe /setowner '*S-1-5-32-544' /Q | Out-Null
    { Assert-AdminOnly $exe } | Should -Not -Throw
    icacls.exe $exe /grant '*S-1-5-11:M' /Q | Out-Null
    { Assert-AdminOnly $exe } | Should -Throw '*can be changed by S-1-5-11*'
  }
}
