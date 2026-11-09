# Run elevated before an OpenVPN connect when dvpnd's OpenVPN adapter is gone.
# x64: "OpenVPN Wintun" (an AmneziaWG tunnel start removes it, UPSTREAM-GAPS #27; OpenVPN 2.6
# cannot start without it). ARM64: "OpenVPN Data Channel Offload" (the arm64 MSI has no Wintun,
# dvpnd uses ovpn-dco there, #83). Creates only that one adapter with OpenVPN's own tapctl.exe -
# nothing else is touched. ASCII only (PowerShell 5.1).
param([string]$Result)
$ErrorActionPreference = 'Continue'

function Write-Result([string]$status, [string]$detail) {
  if ($Result) {
    $json = @{ status = $status; detail = $detail; at = (Get-Date).ToString('o') } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($Result, $json, (New-Object System.Text.UTF8Encoding($false)))
  }
}

try {
  # The machine's own CPU, even when this PowerShell runs emulated.
  $cpu = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment').PROCESSOR_ARCHITECTURE
  $name, $hwid = if ($cpu -eq 'ARM64') { 'OpenVPN Data Channel Offload', 'ovpn-dco' } else { 'OpenVPN Wintun', 'wintun' }
  $pf = if ($env:ProgramW6432) { $env:ProgramW6432 } else { $env:ProgramFiles }
  $tapctl = Join-Path $pf 'OpenVPN\bin\tapctl.exe'
  if (-not (Test-Path -LiteralPath $tapctl)) { Write-Result 'error' 'OpenVPN is not installed (tapctl.exe missing)'; exit 1 }
  $pat = [regex]::Escape($name)
  if ((& $tapctl list 2>&1 | Out-String) -match $pat) { Write-Result 'ok' "already present ($name)"; exit 0 }
  $made = (& $tapctl create --hwid $hwid --name $name 2>&1 | Out-String).Trim()
  if ((& $tapctl list 2>&1 | Out-String) -match $pat) { Write-Result 'ok' "created ($name)"; exit 0 }
  Write-Result 'error' "tapctl: $made"
  exit 1
} catch {
  Write-Result 'error' $_.Exception.Message
  exit 1
}
