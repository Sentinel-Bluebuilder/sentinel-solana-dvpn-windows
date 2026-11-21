# Pester cases for staging-guard.ps1 (rc9-c D1-D3). Run on Windows as SYSTEM or an administrator (Windows testing on w11):
#   Invoke-Pester -Path resources\scripts\staging-guard.Tests.ps1
# A file symlink needs an administrator (or Developer Mode); a junction does not. ASCII only.

BeforeAll {
  . (Join-Path $PSScriptRoot 'staging-guard.ps1')
  function New-Root { $r = Join-Path $env:TEMP ('sg-' + [guid]::NewGuid().ToString('N')); New-Item -ItemType Directory -Path $r | Out-Null; return $r }
}

Describe 'Remove-StagingTree (D1)' {
  It 'a junction INSIDE staging: the canary folder it points at survives, the staging folder is gone' {
    $root = New-Root
    $canary = Join-Path $root 'canary'; New-Item -ItemType Directory -Path $canary | Out-Null
    Set-Content -LiteralPath (Join-Path $canary 'keep.txt') -Value 'keep' -Encoding ASCII
    $stage = Join-Path $root 'daemon-staging'; New-Item -ItemType Directory -Path $stage | Out-Null
    New-Item -ItemType Junction -Path (Join-Path $stage 'evil') -Target $canary | Out-Null
    Remove-StagingTree $stage
    Test-Path -LiteralPath $stage | Should -BeFalse
    Test-Path -LiteralPath (Join-Path $canary 'keep.txt') | Should -BeTrue
  }
  It 'the staging folder itself a junction: only the link goes' {
    $root = New-Root
    $canary = Join-Path $root 'canary'; New-Item -ItemType Directory -Path $canary | Out-Null
    Set-Content -LiteralPath (Join-Path $canary 'keep.txt') -Value 'keep' -Encoding ASCII
    $stage = Join-Path $root 'daemon-staging'
    New-Item -ItemType Junction -Path $stage -Target $canary | Out-Null
    Remove-StagingTree $stage
    Test-Path -LiteralPath (Join-Path $canary 'keep.txt') | Should -BeTrue
  }
}

Describe 'Assert-StagingPath (D1)' {
  It 'refuses a relative path, another folder name and a junction on the path' {
    { Assert-StagingPath 'daemon-staging' @('daemon-staging') } | Should -Throw -ExpectedMessage 'STAGING-PATH*'
    { Assert-StagingPath 'C:\Windows\System32' @('daemon-staging') } | Should -Throw -ExpectedMessage 'STAGING-PATH*'
    $root = New-Root
    $real = Join-Path $root 'real'; New-Item -ItemType Directory -Path (Join-Path $real 'daemon-staging') -Force | Out-Null
    New-Item -ItemType Junction -Path (Join-Path $root 'j') -Target $real | Out-Null
    { Assert-StagingPath (Join-Path $root 'j\daemon-staging') @('daemon-staging') } | Should -Throw -ExpectedMessage 'STAGING-LINK*'
  }
  It 'takes the app staging folder' {
    $root = New-Root
    $p = Join-Path $root 'daemon-staging'; New-Item -ItemType Directory -Path $p | Out-Null
    Assert-StagingPath $p @('daemon-staging') | Should -Be $p
  }
}

Describe 'Copy-StagingSnapshot / Copy-StagedFile (D2/D3)' {
  It 'a symlinked staged config.toml: refused with STAGING-LINK, no snapshot left, nothing copied' {
    $root = New-Root
    $secret = Join-Path $root 'secret.txt'; Set-Content -LiteralPath $secret -Value 'secret' -Encoding ASCII
    $stage = Join-Path $root 'daemon-staging'; New-Item -ItemType Directory -Path $stage | Out-Null
    New-Item -ItemType SymbolicLink -Path (Join-Path $stage 'config.toml') -Target $secret | Out-Null
    $before = @(Get-ChildItem -LiteralPath (Join-Path $env:SystemRoot 'Temp') -Filter 'dvpn-stage-*' -Directory -ErrorAction SilentlyContinue).Count
    { Copy-StagingSnapshot $stage } | Should -Throw -ExpectedMessage 'STAGING-LINK*'
    @(Get-ChildItem -LiteralPath (Join-Path $env:SystemRoot 'Temp') -Filter 'dvpn-stage-*' -Directory -ErrorAction SilentlyContinue).Count | Should -Be $before
  }
  It 'a junction inside staging: refused' {
    $root = New-Root
    $stage = Join-Path $root 'daemon-staging'; New-Item -ItemType Directory -Path $stage | Out-Null
    New-Item -ItemType Junction -Path (Join-Path $stage 'keys') -Target $env:SystemRoot | Out-Null
    { Copy-StagingSnapshot $stage } | Should -Throw -ExpectedMessage 'STAGING-LINK*'
  }
  It 'a hard link: refused' {
    $root = New-Root
    $other = Join-Path $root 'other.txt'; Set-Content -LiteralPath $other -Value 'x' -Encoding ASCII
    $stage = Join-Path $root 'staged'; New-Item -ItemType Directory -Path $stage | Out-Null
    New-Item -ItemType HardLink -Path (Join-Path $stage 'config.toml') -Target $other | Out-Null
    { Copy-StagedFile (Join-Path $stage 'config.toml') (Join-Path $root 'out.toml') 65536 } | Should -Throw -ExpectedMessage 'STAGING-LINK*'
  }
  It 'a plain tree: copied byte for byte into an admin-only snapshot' {
    $root = New-Root
    $stage = Join-Path $root 'daemon-staging'; New-Item -ItemType Directory -Path (Join-Path $stage 'keys') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $stage 'config.toml') -Value "owner = 'A'" -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $stage 'keys\k.json') -Value '{}' -Encoding ASCII
    $snap = Copy-StagingSnapshot $stage
    try {
      (Get-Content -LiteralPath (Join-Path $snap 'config.toml') -Raw) | Should -Be (Get-Content -LiteralPath (Join-Path $stage 'config.toml') -Raw)
      Test-Path -LiteralPath (Join-Path $snap 'keys\k.json') | Should -BeTrue
      $acl = Get-Acl -LiteralPath $snap
      $acl.AreAccessRulesProtected | Should -BeTrue
      @($acl.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } | Where-Object { $_ -notin 'S-1-5-18', 'S-1-5-32-544' }).Count | Should -Be 0
    } finally { Remove-StagingTree $snap }
  }
  It 'over the size limit: STAGING-SIZE' {
    $root = New-Root
    $stage = Join-Path $root 'staged'; New-Item -ItemType Directory -Path $stage | Out-Null
    [System.IO.File]::WriteAllBytes((Join-Path $stage 'config.toml'), (New-Object byte[] 70000))
    { Copy-StagedFile (Join-Path $stage 'config.toml') (Join-Path $root 'o') 65536 } | Should -Throw -ExpectedMessage 'STAGING-SIZE*'
  }
}
