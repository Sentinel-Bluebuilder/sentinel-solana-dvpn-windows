; Devnet dVPN - NSIS hooks (electron-builder `nsis.include`). See docs/INSTALLER.md.
; extraResources land at $INSTDIR\resources\resources; the CLI shim at $INSTDIR\bin.
;
; Install (elevated, perMachine):
;   customInit     stop the VPN service if it runs, so an upgrade can replace its files; keep a
;                  pre-cb33 dvpnd.exe for the home move
;   customInstall  install system drivers (WireGuard, AmneziaWG, OpenVPN 2.6), put the CLI on PATH,
;                  lock a non-Program-Files app folder, move a pre-cb33 service home (daemon migrate),
;                  re-run setup-daemon.ps1 on an existing home (it starts the service)
; Uninstall (order is electron-builder's: customUnInit -> files deleted -> customUnInstall):
;   customUnInit   stop the service + helper, copy the cleanup scripts out of $INSTDIR
;   customUnInstall (full uninstall only, not an upgrade) restore the network, remove the
;                  service + leftover tunnels, take the CLI off PATH. Shared drivers and the
;                  device key folder in ProgramData are kept on purpose.
; The installer is a 32-bit process: always call the 64-bit PowerShell (sysnative).

!macro ddvFindPowerShell OUT
  ${If} ${FileExists} "$WINDIR\sysnative\WindowsPowerShell\v1.0\powershell.exe"
    StrCpy ${OUT} "$WINDIR\sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ${Else}
    StrCpy ${OUT} "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  ${EndIf}
!macroend

!ifndef BUILD_UNINSTALLER
Var ddvPs
Var ddvServiceWasRunning
Var ddvDirFromD

; "/D=C:\Program Files\X" (I9, test-host): NSIS puts the whole folder, spaces included, in
; $INSTDIR before .onInit and cuts " /D=..." off $CMDLINE. electron-builder's initMultiUser then
; re-reads /D with StdUtils.GetParameter, which stops at the first space, so the uninstall entry
; and PATH said C:\Program. preInit runs before initMultiUser: keep NSIS's value when /D was given.
!macro preInit
  StrCpy $ddvDirFromD ""
  ${StdUtils.GetParameter} $R9 "D" ""
  ${If} $R9 != ""
    StrCpy $ddvDirFromD $INSTDIR
  ${EndIf}
!macroend

!macro customInit
  ; One installer per CPU type. The x64 one would install on ARM64 under emulation and its
  ; VPN drivers would never load; the ARM64 one has nothing to install on x64. Exit code 3.
  !ifdef APP_64
  !ifndef APP_ARM64
    ${If} ${IsNativeARM64}
      MessageBox MB_OK|MB_ICONSTOP "This installer is for Intel and AMD (x64) PCs. This PC has an ARM processor.$\r$\n$\r$\nDownload the ARM64 installer of Devnet dVPN instead." /SD IDOK
      SetErrorLevel 3
      Quit
    ${EndIf}
  !endif
  !endif
  !ifdef APP_ARM64
  !ifndef APP_64
    ${IfNot} ${IsNativeARM64}
      MessageBox MB_OK|MB_ICONSTOP "This installer is for ARM PCs. This PC has an Intel or AMD (x64) processor.$\r$\n$\r$\nDownload the x64 installer of Devnet dVPN instead." /SD IDOK
      SetErrorLevel 3
      Quit
    ${EndIf}
  !endif
  !endif
  ; Put back the /D folder NSIS itself parsed (saved in preInit, see there).
  ${If} $ddvDirFromD != ""
    StrCpy $INSTDIR $ddvDirFromD
  ${EndIf}
  ; W-ARM-INST-X86: electron-builder picks $PROGRAMFILES64 only when APP_64 is defined, so the
  ; ARM64-only installer (a 32-bit stub) defaulted to "Program Files (x86)". A fresh ARM64 install
  ; goes to the 64-bit Program Files; a /D folder or an earlier install's folder is kept as is.
  !ifdef APP_ARM64
  !ifndef APP_64
    ReadRegStr $R8 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $ddvDirFromD == ""
    ${AndIf} $R8 == ""
      StrCpy $INSTDIR "$PROGRAMFILES64\${APP_FILENAME}"
    ${EndIf}
  !endif
  !endif
  !insertmacro ddvFindPowerShell $ddvPs
  StrCpy $ddvServiceWasRunning "no"
  ; The cb33 service (sentinel-dvpnd$c0) or, from a pre-cb33 version, "dvpnd". A clean stop ends the
  ; session; a persist kill switch stays held until the new service (or the old binary's uninstall) runs.
  nsExec::ExecToStack '"$ddvPs" -NoProfile -NonInteractive -Command "@(Get-Service -Name sentinel-dvpnd`$$c0, dvpnd -ErrorAction SilentlyContinue | Where-Object Status -eq Running).Count"'
  Pop $0
  Pop $1
  StrCpy $1 $1 1
  ${If} $1 != "0"
    StrCpy $ddvServiceWasRunning "yes"
    nsExec::ExecToLog '"$ddvPs" -NoProfile -NonInteractive -Command "foreach ($$n in @(\"sentinel-dvpnd`$$c0\", \"dvpnd\")) { $$s = Get-Service -Name $$n -ErrorAction SilentlyContinue; if ($$s -and $$s.Status -ne \"Stopped\") { Stop-Service -Name $$n -Force -ErrorAction SilentlyContinue; $$s.WaitForStatus(\"Stopped\", [TimeSpan]::FromSeconds(30)) } }"'
    Pop $0
  ${EndIf}
  ; An update from a pre-cb33 version: keep its dvpnd.exe. The old uninstaller deletes it, and only
  ; that binary's `service uninstall` releases a persist kill switch the old service holds (gap #84).
  ; customInstall hands it to `devnet-dvpn daemon migrate`.
  InitPluginsDir
  ${If} ${FileExists} "$INSTDIR\resources\resources\bin\dvpnd.exe"
    CopyFiles /SILENT "$INSTDIR\resources\resources\bin\dvpnd.exe" "$PLUGINSDIR\legacy-dvpnd.exe"
  ${EndIf}
  ; A short-lived daemon or CLI outside the service (doctor, init, key list) holds the file and an
  ; upgrade then keeps the old binary (test-host: 18.17 left in an 18.20 tree). Only copies from our
  ; folder. $INSTDIR is the previous install's folder on an upgrade (also a /D or user-picked one).
  nsExec::ExecToLog `"$ddvPs" -NoProfile -NonInteractive -Command "Get-Process -Name dvpnd, sentinel-dvpnd, sentinel-dvpn, pipe-bridge -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like '$INSTDIR\*' -or $$_.Path -like '*\Devnet dVPN\*' } | Stop-Process -Force -ErrorAction SilentlyContinue"`
  Pop $0
!macroend

!macro customInstall
  ${If} $ddvPs == ""
    !insertmacro ddvFindPowerShell $ddvPs
  ${EndIf}
  DetailPrint "Installing VPN drivers (WireGuard, AmneziaWG, OpenVPN)..."
  nsExec::ExecToLog '"$ddvPs" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\resources\scripts\install-deps.ps1" -DepsDir "$INSTDIR\resources\resources\deps"'
  Pop $0
  DetailPrint "VPN drivers finished (exit $0)"
  ${If} $0 != "0"
    MessageBox MB_OK|MB_ICONEXCLAMATION "Some VPN drivers could not be installed. Devnet dVPN still works with the protocols that are ready.$\r$\n$\r$\nOpen the app and go to Diagnostics to see what is missing and repair it.$\r$\n$\r$\nDetails: %ProgramData%\Devnet dVPN\install-deps.log" /SD IDOK
  ${EndIf}

  DetailPrint "Adding the devnet-dvpn command to PATH..."
  nsExec::ExecToLog '"$ddvPs" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\resources\scripts\path-entry.ps1" -Dir "$INSTDIR\bin"'
  Pop $0
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000

  ; The service runs programs from $INSTDIR\resources\resources\bin as SYSTEM. Under Program Files
  ; only administrators can change them; a folder picked elsewhere (/D=C:\DevnetDVPN) inherits
  ; "Authenticated Users: Modify" from C:\, so it gets the Program Files rule here. setup-daemon.ps1
  ; refuses to install the service from a folder a standard user can change.
  StrLen $1 "$PROGRAMFILES64\"
  StrCpy $2 "$INSTDIR\" $1
  StrLen $3 "$PROGRAMFILES\"
  StrCpy $4 "$INSTDIR\" $3
  ${If} $2 != "$PROGRAMFILES64\"
  ${AndIf} $4 != "$PROGRAMFILES\"
    DetailPrint "Restricting the app folder to administrators..."
    nsExec::ExecToLog 'icacls "$INSTDIR" /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F *S-1-5-32-545:(OI)(CI)RX /T /C /Q'
    Pop $0
    ${If} $0 != "0"
      MessageBox MB_OK|MB_ICONEXCLAMATION "The app folder could not be restricted to administrators, so the VPN service will not be installed from it.$\r$\n$\r$\nInstall Devnet dVPN into Program Files instead." /SD IDOK
    ${EndIf}
  ${EndIf}

  ReadEnvStr $5 ProgramData
  ; An update from a pre-cb33 version: move its service home (%ProgramData%\dvpnd\client) to the cb33
  ; instance (%ProgramData%\sentinel-dvpn\c0) with the same device key and settings, removing the old
  ; "dvpnd" service with its own binary first. No-op on a fresh install or when already moved.
  ${If} ${FileExists} "$5\dvpnd\client\config.toml"
    DetailPrint "Moving the VPN service to its new home..."
    nsExec::ExecToLog '"$SYSDIR\cmd.exe" /c ""$INSTDIR\bin\devnet-dvpn.cmd" daemon migrate --yes --legacy-dvpnd "$PLUGINSDIR\legacy-dvpnd.exe""'
    Pop $0
    DetailPrint "VPN service home move finished (exit $0)"
  ${EndIf}

  ; A service home in place (an update): (re)install the service on it, lock it, give the signed-in
  ; user the pipe group, set the service's own PATH, and start it. setup-daemon.ps1 is idempotent.
  ; Fresh install: nothing yet, the app runs setup after device setup.
  ${If} ${FileExists} "$5\sentinel-dvpn\c0\config.toml"
    DetailPrint "Updating the VPN service..."
    nsExec::ExecToLog '"$ddvPs" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\resources\scripts\setup-daemon.ps1" -Dvpnd "$INSTDIR\resources\resources\bin\sentinel-dvpnd.exe" -DaemonHome "$5\sentinel-dvpn\c0" -Result "$PLUGINSDIR\setup-daemon.json" -BinRoot "$INSTDIR\resources\resources\bin"'
    Pop $0
    DetailPrint "VPN service update finished (exit $0; was running: $ddvServiceWasRunning)"
  ${EndIf}
!macroend
!endif

!ifdef BUILD_UNINSTALLER
Var ddvUnPs

!macro customUnInit
  !insertmacro ddvFindPowerShell $ddvUnPs
  ; Files in use cannot be deleted: stop the service and the app's pipe helper first.
  nsExec::ExecToLog '"$ddvUnPs" -NoProfile -NonInteractive -Command "Stop-Service -Name sentinel-dvpnd`$$c0, dvpnd -Force -ErrorAction SilentlyContinue; Stop-Process -Name pipe-bridge -Force -ErrorAction SilentlyContinue"'
  Pop $0
  ; Also a short-lived daemon or CLI outside the service (doctor, init), only from our folder.
  nsExec::ExecToLog `"$ddvUnPs" -NoProfile -NonInteractive -Command "Get-Process -Name dvpnd, sentinel-dvpnd, sentinel-dvpn -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like '$INSTDIR\*' -or $$_.Path -like '*\Devnet dVPN\*' } | Stop-Process -Force -ErrorAction SilentlyContinue"`
  Pop $0
  ; The scripts live in $INSTDIR, which is gone by the time customUnInstall runs.
  InitPluginsDir
  CopyFiles /SILENT "$INSTDIR\resources\resources\scripts\uninstall-cleanup.ps1" "$PLUGINSDIR"
  CopyFiles /SILENT "$INSTDIR\resources\resources\scripts\path-entry.ps1" "$PLUGINSDIR"
  CopyFiles /SILENT "$INSTDIR\resources\resources\scripts\sysproxy.ps1" "$PLUGINSDIR"
  CopyFiles /SILENT "$INSTDIR\resources\resources\bin\sentinel-dvpnd.exe" "$PLUGINSDIR"
!macroend

!macro customUnInstall
  ${IfNot} ${isUpdated}
    DetailPrint "Restoring network settings and removing the VPN service..."
    nsExec::ExecToLog '"$ddvUnPs" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\uninstall-cleanup.ps1" -Dvpnd "$PLUGINSDIR\sentinel-dvpnd.exe"'
    Pop $0
    DetailPrint "Network cleanup finished (exit $0)"
    nsExec::ExecToLog '"$ddvUnPs" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\path-entry.ps1" -Dir "$INSTDIR\bin" -Remove'
    Pop $0
    SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
  ${EndIf}
!macroend
!endif
