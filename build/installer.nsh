; Devnet dVPN - NSIS hooks (electron-builder `nsis.include`). See docs/INSTALLER.md.
; extraResources land at $INSTDIR\resources\resources; the CLI shim at $INSTDIR\bin.
;
; Install (elevated, perMachine):
;   customInit     stop the VPN service if it runs, so an upgrade can replace its files; keep a
;                  pre-cb33 dvpnd.exe for the home move
;   customInstall  install system drivers (WireGuard, AmneziaWG, OpenVPN 2.6), put the CLI on PATH,
;                  lock a non-Program-Files app folder, move a pre-cb33 service home (daemon migrate),
;                  re-run setup-daemon.ps1 on an existing home (it starts the service; if it fails,
;                  a plain Start-Service), one line per step in c0\install-update.log (Q0576)
; Uninstall (order is electron-builder's: customUnInit -> files deleted -> customUnInstall):
;   customUnInit   stop the service + helper, copy the cleanup scripts out of $INSTDIR
;   customUnInstall (full uninstall only, not an upgrade) restore the network, remove the
;                  service + leftover tunnels, take the CLI off PATH. Shared drivers and the
;                  device key folder in ProgramData are kept on purpose.
; The installer is a 32-bit process: always call the 64-bit PowerShell (sysnative).

; Q0576: an installer started from a PowerShell 7 window (or any pwsh parent) inherits 7's
; PSModulePath, and every Windows PowerShell 5.1 child below then autoloads 7's modules: Get-Acl in
; setup-daemon.ps1 died in Import-Module ("TypeData ... AuditToString is already present") after one
; second, so an update left the VPN service stopped (owner laptop 0.2.1 -> rc.2, 2026-11-14).
; Removing the variable makes 5.1 build its own default path (as elevate.ts does for the app).
!macro ddvCleanPsEnv
  System::Call 'kernel32::SetEnvironmentVariable(t "PSModulePath", p 0)'
!macroend

!macro ddvFindPowerShell OUT
  !insertmacro ddvCleanPsEnv
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
Var ddvPsPathIn

; Q0576: one line per update in %ProgramData%\sentinel-dvpn\c0\install-update.log (SYSTEM +
; Administrators only, like the folder), so a service an update left stopped is evidence, not a
; guess: UTC time, version, whether the service ran before, setup-daemon's exit code and result
; JSON, the service state after, and the PSModulePath the installer was started with.
; DIR = the service home; STEP = what ran; CODE = its exit code; JSON = the result file.
!macro ddvUpdateLog DIR STEP CODE JSON
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $R7
  ; UTC time first. SYSTEMTIME = year, month, weekday, day, hour, minute, second, ms (WORDs).
  System::Call '*(&i2, &i2, &i2, &i2, &i2, &i2, &i2, &i2) p .R0'
  System::Call 'kernel32::GetSystemTime(p R0)'
  System::Call '*$R0(&i2 .R1, &i2 .R2, &i2, &i2 .R3, &i2 .R4, &i2 .R5, &i2 .R6)'
  System::Free $R0
  IntFmt $R2 "%02d" $R2
  IntFmt $R3 "%02d" $R3
  IntFmt $R4 "%02d" $R4
  IntFmt $R5 "%02d" $R5
  IntFmt $R6 "%02d" $R6
  StrCpy $R1 "$R1-$R2-$R3T$R4:$R5:$R6Z"
  StrCpy $R7 "(no result file)"
  ${If} ${FileExists} "${JSON}"
    FileOpen $R0 "${JSON}" r
    FileRead $R0 $R7
    FileClose $R0
  ${EndIf}
  ; [Console]::Write: no trailing newline inside the log line.
  nsExec::ExecToStack '"$ddvPs" -NoProfile -NonInteractive -Command "[Console]::Write([string](Get-Service -Name sentinel-dvpnd`$$c0 -ErrorAction SilentlyContinue).Status)"'
  Pop $R0
  Pop $R6
  StrCpy $R6 $R6 20
  ${If} $R6 == ""
    StrCpy $R6 "absent"
  ${EndIf}
  ClearErrors
  FileOpen $R0 "${DIR}\install-update.log" a
  ${IfNot} ${Errors}
    FileSeek $R0 0 END
    FileWrite $R0 "$R1 ${VERSION} step=${STEP} exit=${CODE} wasRunning=$ddvServiceWasRunning after=$R6 result=$R7 psModulePathIn=$ddvPsPathIn$\r$\n"
    FileClose $R0
  ${EndIf}
  ClearErrors
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

; "/D=C:\Program Files\X" (I9, ddv-win-f): NSIS puts the whole folder, spaces included, in
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

; rc9-f W-D-RACE (Windows testing audit, H): the app folder is locked BEFORE any file is unpacked into it
; (resources/scripts/guard-app-folder.ps1). R1/R1b locked it in customInstall, after the ~60 s unpack: a folder a
; standard user made beforehand kept files planted in it, and its owner could swap install-deps.ps1 or
; sentinel-dvpnd.exe mid-unpack, which customInstall then ran elevated. The scripts are embedded in the installer (the
; app folder holds nothing to trust yet). Run in customInit (before anything is read from the folder) and in
; customUnInstallCheck (after an update's old uninstaller, which removes the folder, and before electron-builder's
; SetOutPath + unpack). customInstall's lock and verify stay.
!macro ddvGateAppFolder DIR MODE
  ${If} $ddvPs == ""
    !insertmacro ddvFindPowerShell $ddvPs
  ${EndIf}
  InitPluginsDir
  ; rc9-f2 (Windows testing live): electron-builder's .onInit starts with SetOutPath $INSTDIR, so the installer's current
  ; directory is the app folder and the guard could not replace an empty untrusted one ("in use"). Not moved back:
  ; SetOutPath $INSTDIR would make the removed folder again with C:\'s inherited ACL. Every path below and after is
  ; absolute; electron-builder's install section does its own SetOutPath $INSTDIR before the unpack.
  ; rc9-f3 (Windows testing live): an EMPTY folder, not $PLUGINSDIR itself: that holds NSIS's 32-bit System.dll, and the
  ; scripts' Add-Type (csc) resolved System.dll from the cwd first, so every upgrade's assert exited 2.
  CreateDirectory "$PLUGINSDIR\ddv-cwd"
  SetOutPath "$PLUGINSDIR\ddv-cwd"
  File "/oname=$PLUGINSDIR\guard-app-folder.ps1" "${PROJECT_DIR}\resources\scripts\guard-app-folder.ps1"
  File "/oname=$PLUGINSDIR\assert-app-folder.ps1" "${PROJECT_DIR}\resources\scripts\assert-app-folder.ps1"
  File "/oname=$PLUGINSDIR\setup-daemon.ps1" "${PROJECT_DIR}\resources\scripts\setup-daemon.ps1"
  File "/oname=$PLUGINSDIR\staging-guard.ps1" "${PROJECT_DIR}\resources\scripts\staging-guard.ps1"
  nsExec::ExecToStack '"$ddvPs" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\guard-app-folder.ps1" -Dir "${DIR}" -ProgramFiles64 "$PROGRAMFILES64" -ProgramFiles32 "$PROGRAMFILES" ${MODE}'
  Pop $0
  Pop $1
  DetailPrint "App folder check: $1"
  ${If} $0 != "0"
    MessageBox MB_OK|MB_ICONSTOP "Devnet dVPN was not installed into ${DIR} (folder check exit $0).$\r$\n$\r$\n$1" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  ${If} ${FileExists} "${DIR}\*.*"
    nsExec::ExecToStack '"$ddvPs" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\assert-app-folder.ps1" -Dir "${DIR}"'
    Pop $0
    Pop $1
    ${If} $0 != "0"
      MessageBox MB_OK|MB_ICONSTOP "The app folder ${DIR} is not locked to administrators (check exit $0), so nothing was installed into it.$\r$\n$\r$\n$1" /SD IDOK
      SetErrorLevel 2
      Quit
    ${EndIf}
  ${EndIf}
!macroend

; rc9-f W-D-RACE: electron-builder calls this from handleUninstallResult right after an update's old uninstaller and
; right before its SetOutPath $INSTDIR + unpack, on EVERY install (no old version: no error, $R0 0). The directory
; page and instFilesPre have run by then, so $INSTDIR is final. Defining it replaces electron-builder's checks, so
; they are kept here as they were.
!macro customUnInstallCheck
  ${If} ${Errors}
    DetailPrint `Uninstall was not successful. Not able to launch uninstaller!`
  ${ElseIf} $R0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"
    DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`
    SetErrorLevel 2
    Quit
  ${EndIf}
  !insertmacro ddvGateAppFolder "$INSTDIR" ""
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
  ; For install-update.log: the module path the installer was started with (ddvFindPowerShell
  ; removes it for every PowerShell child, Q0576).
  ReadEnvStr $ddvPsPathIn PSModulePath
  ${If} $ddvPsPathIn == ""
    StrCpy $ddvPsPathIn "(none)"
  ${EndIf}
  !insertmacro ddvFindPowerShell $ddvPs
  ; rc9-f W-D-RACE: before anything is read from the folder (the legacy dvpnd.exe copied below is run elevated by
  ; customInstall; the old uninstaller is copied out of the remembered folder and run). A folder not there yet is made
  ; at unpack time (customUnInstallCheck). The remembered folder is checked too when /D points somewhere else.
  !insertmacro ddvGateAppFolder "$INSTDIR" "-NoCreate"
  ReadRegStr $R7 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $R7 != ""
  ${AndIf} $R7 != $INSTDIR
    !insertmacro ddvGateAppFolder "$R7" "-NoCreate"
  ${EndIf}
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
  ; upgrade then keeps the old binary (ddv-w11a: 18.17 left in an 18.20 tree). Only copies from our
  ; folder. $INSTDIR is the previous install's folder on an upgrade (also a /D or user-picked one).
  nsExec::ExecToLog `"$ddvPs" -NoProfile -NonInteractive -Command "Get-Process -Name dvpnd, sentinel-dvpnd, sentinel-dvpn, pipe-bridge -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like '$INSTDIR\*' -or $$_.Path -like '*\Devnet dVPN\*' } | Stop-Process -Force -ErrorAction SilentlyContinue"`
  Pop $0
!macroend

!macro customInstall
  ${If} $ddvPs == ""
    !insertmacro ddvFindPowerShell $ddvPs
  ${EndIf}
  ; R1 (rc9-c2, macOS testing audit): FIRST, before any script runs elevated from $INSTDIR. The service runs programs
  ; from $INSTDIR\resources\resources\bin as SYSTEM, and this installer runs install-deps.ps1, path-entry.ps1 and
  ; setup-daemon.ps1 from it elevated. A folder a standard user created (/D=C:\DevnetDVPN made beforehand) stays
  ; OWNED by that user, and an owner may always rewrite the ACL: so the owner becomes Administrators, on every
  ; install. Outside Program Files the folder then gets the Program Files rule (a folder picked there inherits
  ; "Authenticated Users: Modify" from C:\). Either step failing stops the install: nothing runs from a folder a
  ; standard user can change. setup-daemon.ps1 checks the same (Assert-AdminOnly: owner and ACEs).
  DetailPrint "Making administrators the owner of the app folder..."
  nsExec::ExecToLog 'icacls "$INSTDIR" /setowner *S-1-5-32-544 /T /C /Q'
  Pop $0
  ${If} $0 != "0"
    MessageBox MB_OK|MB_ICONSTOP "The app folder $INSTDIR could not be given to the administrators group (icacls exit $0), so nothing was installed from it.$\r$\n$\r$\nInstall Devnet dVPN into Program Files instead." /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
  StrLen $1 "$PROGRAMFILES64\"
  StrCpy $2 "$INSTDIR\" $1
  StrLen $3 "$PROGRAMFILES\"
  StrCpy $4 "$INSTDIR\" $3
  ${If} $2 != "$PROGRAMFILES64\"
  ${AndIf} $4 != "$PROGRAMFILES\"
    DetailPrint "Restricting the app folder to administrators..."
    ; R1b (rc9-d, Windows testing w11): separate calls. R1's single combined icacls call (with /T) exited 0 but left
    ; Authenticated Users:Modify on the folder and an EMPTY ACL on every file. Grant first, then cut inheritance, then
    ; remove the broad groups, then reset every child to inherit the locked folder's ACL.
    nsExec::ExecToLog 'icacls "$INSTDIR" /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F *S-1-5-32-545:(OI)(CI)RX /Q'
    Pop $0
    ${If} $0 != "0"
      MessageBox MB_OK|MB_ICONSTOP "The app folder $INSTDIR could not be restricted to administrators (grant: icacls exit $0), so nothing was installed from it.$\r$\n$\r$\nInstall Devnet dVPN into Program Files instead." /SD IDOK
      SetErrorLevel 2
      Abort
    ${EndIf}
    nsExec::ExecToLog 'icacls "$INSTDIR" /inheritance:r /Q'
    Pop $0
    ${If} $0 != "0"
      MessageBox MB_OK|MB_ICONSTOP "The app folder $INSTDIR could not be restricted to administrators (inheritance: icacls exit $0), so nothing was installed from it.$\r$\n$\r$\nInstall Devnet dVPN into Program Files instead." /SD IDOK
      SetErrorLevel 2
      Abort
    ${EndIf}
    nsExec::ExecToLog 'icacls "$INSTDIR" /remove:g *S-1-1-0 *S-1-5-11 /Q'
    Pop $0
    ${If} $0 != "0"
      MessageBox MB_OK|MB_ICONSTOP "The app folder $INSTDIR could not be restricted to administrators (remove: icacls exit $0), so nothing was installed from it.$\r$\n$\r$\nInstall Devnet dVPN into Program Files instead." /SD IDOK
      SetErrorLevel 2
      Abort
    ${EndIf}
    nsExec::ExecToLog 'icacls "$INSTDIR\*" /reset /T /C /Q'
    Pop $0
    ${If} $0 != "0"
      MessageBox MB_OK|MB_ICONSTOP "The app folder $INSTDIR could not be restricted to administrators (reset: icacls exit $0), so nothing was installed from it.$\r$\n$\r$\nInstall Devnet dVPN into Program Files instead." /SD IDOK
      SetErrorLevel 2
      Abort
    ${EndIf}
  ${EndIf}
  ; R1b: verify the result on EVERY install (upgrades too: a plain /S reinstall goes back to the remembered folder),
  ; never trust the exit codes. The check runs from $PLUGINSDIR (the installer's own folder), not from $INSTDIR.
  InitPluginsDir
  CopyFiles /SILENT "$INSTDIR\resources\resources\scripts\assert-app-folder.ps1" "$PLUGINSDIR"
  CopyFiles /SILENT "$INSTDIR\resources\resources\scripts\setup-daemon.ps1" "$PLUGINSDIR"
  CopyFiles /SILENT "$INSTDIR\resources\resources\scripts\staging-guard.ps1" "$PLUGINSDIR"
  nsExec::ExecToLog '"$ddvPs" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\assert-app-folder.ps1" -Dir "$INSTDIR"'
  Pop $0
  ${If} $0 != "0"
    MessageBox MB_OK|MB_ICONSTOP "The app folder $INSTDIR is not locked to administrators (check exit $0), so nothing was installed from it.$\r$\n$\r$\nInstall Devnet dVPN into Program Files instead." /SD IDOK
    SetErrorLevel 2
    Abort
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
    !insertmacro ddvUpdateLog "$5\sentinel-dvpn\c0" "setup-daemon" $0 "$PLUGINSDIR\setup-daemon.json"
    ${If} $0 != "0"
      ; Q0576: setup-daemon stopped before it started the service. The service as it was (same
      ; home, same config) is better than no service: start it plainly and record that too.
      DetailPrint "Starting the VPN service as it was..."
      nsExec::ExecToLog '"$ddvPs" -NoProfile -NonInteractive -Command "Start-Service -Name sentinel-dvpnd`$$c0 -ErrorAction Stop; (Get-Service -Name sentinel-dvpnd`$$c0).WaitForStatus(\"Running\", [TimeSpan]::FromSeconds(30))"'
      Pop $1
      !insertmacro ddvUpdateLog "$5\sentinel-dvpn\c0" "start-fallback" $1 ""
      ${If} $1 != "0"
        MessageBox MB_OK|MB_ICONEXCLAMATION "The VPN service could not be started after the update.$\r$\n$\r$\nOpen Devnet dVPN and press Start the VPN service. Details are in %ProgramData%\sentinel-dvpn\c0\install-update.log." /SD IDOK
      ${EndIf}
    ${EndIf}
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
