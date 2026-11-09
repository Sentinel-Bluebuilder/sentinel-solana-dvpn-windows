# Pester tests for setup-daemon.ps1's admin-only ACL guard (F1.5 / fleet-security the Android app ancestor walk).
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
