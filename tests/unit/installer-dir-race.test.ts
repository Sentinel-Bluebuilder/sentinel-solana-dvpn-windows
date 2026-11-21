// ─── rc9-f W-D-RACE (Windows testing audit, H): the app folder is locked before the unpack, not after it ───
// R1/R1b locked it in customInstall, after the ~60 s unpack. Static checks of build/installer.nsh, and of the
// electron-builder templates it hooks into (the order is theirs). The ACL behaviour is guard-app-folder.Tests.ps1
// (Pester, Windows testing on w11).
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';

const NSH = fs.readFileSync('build/installer.nsh', 'utf8');
const T = 'node_modules/app-builder-lib/templates/nsis';
const macro = (name: string): string => {
  const a = NSH.indexOf(`!macro ${name}`);
  expect(a, name).toBeGreaterThan(-1);
  return NSH.slice(a, NSH.indexOf('!macroend', a));
};
const GUARD_RUN = '-File "$PLUGINSDIR\\guard-app-folder.ps1" -Dir "${DIR}" -ProgramFiles64 "$PROGRAMFILES64" -ProgramFiles32 "$PROGRAMFILES" ${MODE}';

describe('rc9-f: the gate macro', () => {
  it('embeds the scripts (the app folder holds nothing to trust yet) and runs the guard, then the read-back', () => {
    const g = macro('ddvGateAppFolder');
    for (const f of ['guard-app-folder.ps1', 'assert-app-folder.ps1', 'setup-daemon.ps1', 'staging-guard.ps1']) {
      expect(g).toContain(`File "/oname=$PLUGINSDIR\\${f}" "\${PROJECT_DIR}\\resources\\scripts\\${f}"`);
    }
    expect(g).not.toContain('$INSTDIR\\resources');
    const run = g.indexOf(GUARD_RUN);
    expect(run).toBeGreaterThan(g.lastIndexOf('File "/oname='));
    expect(g.indexOf('-File "$PLUGINSDIR\\assert-app-folder.ps1" -Dir "${DIR}"')).toBeGreaterThan(run);
    expect(g.match(/\$\{If\} \$0 != "0"[\s\S]*?SetErrorLevel 2\s+Quit/g)?.length).toBe(2);
  });
  it('rc9-f2: the installer leaves the app folder as its current directory before the guard, and never goes back', () => {
    const g = macro('ddvGateAppFolder');
    const out = g.indexOf('SetOutPath "$PLUGINSDIR\\ddv-cwd"'); // rc9-f3: an empty folder
    expect(out).toBeGreaterThan(g.indexOf('InitPluginsDir'));
    expect(out).toBeLessThan(g.indexOf(GUARD_RUN));
    const code = g.split('\n').filter((l) => !l.trim().startsWith(';')).join('\n'); // NSIS comments say why
    expect(code).not.toMatch(/SetOutPath \$(INSTDIR|OUTDIR)|Pop \$OUTDIR/);
    // electron-builder's .onInit is what makes the app folder the current directory (the Windows testing failure).
    expect(fs.readFileSync(`${T}/installer.nsi`, 'utf8')).toMatch(/Function \.onInit\s+Call setInstallSectionSpaceRequired\s+SetOutPath \$INSTDIR/);
    const ps = fs.readFileSync('resources/scripts/guard-app-folder.ps1', 'utf8');
    const fn = ps.slice(ps.indexOf('function Invoke-AppFolderGuard'));
    expect(fn.slice(0, 400)).toContain('[System.IO.Directory]::SetCurrentDirectory($env:SystemRoot)');
    expect(ps.indexOf('Set-Location -LiteralPath $env:SystemRoot')).toBeLessThan(ps.indexOf(". (Join-Path $PSScriptRoot 'setup-daemon.ps1')"));
  });
  it('electron-builder defines PROJECT_DIR for the File lines', () => {
    expect(fs.readFileSync('node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js', 'utf8')).toContain('PROJECT_DIR: packager.projectDir');
  });
  it('the guard: Program Files skipped, parents checked, a non-empty user folder refused, a new folder made locked', () => {
    const ps = fs.readFileSync('resources/scripts/guard-app-folder.ps1', 'utf8');
    expect(ps).toMatch(/Assert-AdminOnlyChain \$parent/);
    expect(ps).toMatch(/if \(-not \(Test-DirEmpty \$full\)\) \{\n\s+return @\{ code = 2/);
    expect(ps).toContain('[System.IO.Directory]::CreateDirectory($full, (New-AppDirSecurity))');
    expect(ps).toContain("@($full, '/setowner', '*S-1-5-32-544', '/T', '/C', '/Q')");
    expect(ps).toMatch(/exit \$r\.code/);
    expect(/[^\x00-\x7f]/.test(ps)).toBe(false);
  });
});

describe('rc9-f: where it runs', () => {
  it('customInit: before anything is read from $INSTDIR, for $INSTDIR and the remembered folder', () => {
    const c = macro('customInit');
    const gate = c.indexOf('!insertmacro ddvGateAppFolder "$INSTDIR" "-NoCreate"');
    expect(gate).toBeGreaterThan(-1);
    expect(c).toContain('!insertmacro ddvGateAppFolder "$R7" "-NoCreate"');
    for (const read of ['CopyFiles /SILENT "$INSTDIR', "$$_.Path -like '$INSTDIR", 'nsExec::']) {
      const at = c.indexOf(read);
      expect(at, read).toBeGreaterThan(gate);
    }
  });
  it('customUnInstallCheck: the full gate on $INSTDIR, with electron-builder\'s own checks kept', () => {
    const u = macro('customUnInstallCheck');
    expect(u).toContain('$(uninstallFailed): $R0');
    expect(u).toMatch(/\$\{ElseIf\} \$R0 != 0[\s\S]*SetErrorLevel 2\s+Quit/);
    expect(u.indexOf('!insertmacro ddvGateAppFolder "$INSTDIR" ""')).toBeGreaterThan(u.indexOf('${EndIf}'));
  });
  it('electron-builder: customUnInstallCheck runs after the old uninstaller and before SetOutPath + the unpack', () => {
    expect(fs.readFileSync(`${T}/include/installUtil.nsh`, 'utf8')).toMatch(/"SHELL_CONTEXT"\s+!ifmacrodef customUnInstallCheck\s+!insertmacro customUnInstallCheck/);
    const s = fs.readFileSync(`${T}/installSection.nsh`, 'utf8');
    const check = s.indexOf('!insertmacro handleUninstallResult SHELL_CONTEXT');
    const out = s.indexOf('SetOutPath $INSTDIR');
    expect(check).toBeGreaterThan(-1);
    expect(out).toBeGreaterThan(check);
    expect(s.indexOf('!insertmacro installApplicationFiles')).toBeGreaterThan(out);
    expect(s.slice(0, check)).not.toMatch(/SetOutPath|installApplicationFiles|File \/oname=(?!\$PLUGINSDIR)/);
  });
  it('customInstall keeps its lock and verify', () => {
    const i = macro('customInstall');
    expect(i).toContain('icacls "$INSTDIR" /setowner *S-1-5-32-544 /T /C /Q');
    expect(i).toContain('-File "$PLUGINSDIR\\assert-app-folder.ps1" -Dir "$INSTDIR"');
  });
});

describe('rc9-f W-WIN-11: the read-back checks every child too', () => {
  it('assert-app-folder runs Assert-AdminOnly on each file and folder under the app folder', () => {
    const ps = fs.readFileSync('resources/scripts/assert-app-folder.ps1', 'utf8');
    expect(ps).toMatch(/foreach \(\$item in Get-ChildItem -LiteralPath \$Dir -Recurse -Force\) \{[\s\S]{0,400}Assert-AdminOnly \$item\.FullName/);
  });
});
