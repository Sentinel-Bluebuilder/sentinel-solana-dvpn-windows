# --- path-entry - add or remove one folder on the machine PATH ---
# Run elevated by the installer (add) and uninstaller (remove) so `devnet-dvpn`
# works in any new terminal. Reads and writes the raw registry value, so
# %VARIABLES% other entries use stay unexpanded. Exact-match, case-insensitive.
param(
  [Parameter(Mandatory = $true)][string]$Dir,
  [switch]$Remove
)
# rc9-f3 (Windows testing live): never compile or load from the caller's current directory. The installer starts this from
# a folder that may hold NSIS's 32-bit System.dll, and Add-Type's csc resolves System.dll from the cwd first.
Set-Location -LiteralPath $env:SystemRoot
[System.IO.Directory]::SetCurrentDirectory($env:SystemRoot)
$ErrorActionPreference = 'Stop'
$key = 'SYSTEM\CurrentControlSet\Control\Session Manager\Environment'
$reg = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($key, $true)
try {
  $raw = [string]$reg.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  $want = $Dir.TrimEnd('\')
  $parts = @($raw -split ';' | Where-Object { $_ -ne '' })
  $kept = @($parts | Where-Object { $_.TrimEnd('\') -ine $want })
  if ($Remove) {
    if ($kept.Count -eq $parts.Count) { Write-Output 'PATH: entry not present'; exit 0 }
    $next = $kept
  } else {
    if ($kept.Count -ne $parts.Count) { Write-Output 'PATH: entry already present'; exit 0 }
    $next = $parts + $want
  }
  $reg.SetValue('Path', ($next -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)
  # WIN-W11 (the agent tools rc.9): tell running programs (Explorer, so the terminals it opens) the environment changed;
  # without it a terminal opened from the desktop had no devnet-dvpn until the next sign-in. A failure is only a warning.
  try {
    if (-not ('DdvEnv.Msg' -as [type])) {
      Add-Type -Namespace DdvEnv -Name Msg -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);'
    }
    $res = [UIntPtr]::Zero
    [void][DdvEnv.Msg]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$res)
  } catch { Write-Output "PATH: broadcast failed (new terminals see it after sign-in): $($_.Exception.Message)" }
  Write-Output ('PATH: {0} {1}' -f $(if ($Remove) { 'removed' } else { 'added' }), $want)
} catch {
  Write-Output "PATH update failed: $($_.Exception.Message)"
  exit 1
} finally {
  $reg.Close()
}
exit 0
