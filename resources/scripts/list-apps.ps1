# list-apps.ps1 - apps a person can choose for split tunnelling (read-only, no admin).
# Prints one JSON object: { shortcuts: [{name, target}], procs: [{name, path}], apppaths: [{name, target}] }
#   shortcuts = Start Menu .lnk files (all users + this user) resolved to their target
#   procs     = running programs that have a window (path readable without admin)
#   apppaths  = registered App Paths (HKLM/HKCU, 64+32-bit): apps with no Start Menu shortcut for this user
#               (Microsoft Edge on the x64 test VM, W5 b), named by the file's description
# Filtering, merging and sorting happen in src/core/split/apps.ts (unit-tested).
# ASCII only: Windows PowerShell 5.1 reads BOM-less files as cp1252.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$roots = @(
  (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs'),
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs')
)
$shell = New-Object -ComObject WScript.Shell
$shortcuts = New-Object System.Collections.ArrayList
foreach ($root in $roots) {
  if (-not (Test-Path -LiteralPath $root)) { continue }
  foreach ($lnk in Get-ChildItem -LiteralPath $root -Recurse -Filter '*.lnk' -File) {
    $target = $shell.CreateShortcut($lnk.FullName).TargetPath
    if ($target -and $target.ToLower().EndsWith('.exe') -and (Test-Path -LiteralPath $target)) {
      [void]$shortcuts.Add([pscustomobject]@{ name = $lnk.BaseName; target = $target })
    }
  }
}

$procs = New-Object System.Collections.ArrayList
foreach ($p in Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Path }) {
  $label = $p.Description
  if (-not $label) { $label = $p.ProcessName }
  [void]$procs.Add([pscustomobject]@{ name = $label; path = $p.Path })
}

$apppaths = New-Object System.Collections.ArrayList
$apRoots = @(
  'HKLM:SOFTWAREMicrosoftWindowsCurrentVersionApp Paths',
  'HKLM:SOFTWAREWOW6432NodeMicrosoftWindowsCurrentVersionApp Paths',
  'HKCU:SOFTWAREMicrosoftWindowsCurrentVersionApp Paths'
)
foreach ($r in $apRoots) {
  foreach ($k in Get-ChildItem -LiteralPath $r) {
    $exe = [string](Get-ItemProperty -LiteralPath $k.PSPath).'(default)'
    if ($exe) { $exe = [Environment]::ExpandEnvironmentVariables($exe.Trim('"')) }
    if ($exe -and $exe.ToLower().EndsWith('.exe') -and (Test-Path -LiteralPath $exe)) {
      $desc = (Get-Item -LiteralPath $exe).VersionInfo.FileDescription
      if ($desc) { [void]$apppaths.Add([pscustomobject]@{ name = $desc.Trim(); target = $exe }) }
    }
  }
}

[pscustomobject]@{ shortcuts = @($shortcuts); procs = @($procs); apppaths = @($apppaths) } | ConvertTo-Json -Depth 3 -Compress
