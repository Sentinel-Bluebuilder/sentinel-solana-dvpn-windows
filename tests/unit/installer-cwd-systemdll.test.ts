// ─── rc9-f3 (Windows testing live, every upgrade exited 2): the gate's cwd holds no DLL; the scripts never use the cwd ───
// rc9-f2 made $PLUGINSDIR the cwd. It holds NSIS's 32-bit System.dll, and Add-Type's csc resolves System.dll from the
// cwd first: "Metadata file '...\nsw425.tmp\System.dll' could not be opened -- incorrect format". The live case is
// guard-app-folder.Tests.ps1 'rc9-f3' (child PowerShells started from a folder holding a non-.NET System.dll).
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';

const nsh = fs.readFileSync('build/installer.nsh', 'utf8');
const gate = nsh.slice(nsh.indexOf('!macro ddvGateAppFolder'), nsh.indexOf('!macroend', nsh.indexOf('!macro ddvGateAppFolder')));
const code = (s: string): string => s.split('\n').filter((l) => !l.trim().startsWith(';')).join('\n');

describe('rc9-f3: no System.dll in the gate\'s current directory', () => {
  it('the gate runs from an empty $PLUGINSDIR\\ddv-cwd, never $PLUGINSDIR itself', () => {
    const c = code(gate);
    expect(c).toContain('CreateDirectory "$PLUGINSDIR\\ddv-cwd"\n  SetOutPath "$PLUGINSDIR\\ddv-cwd"');
    expect(c).not.toMatch(/SetOutPath "?\$PLUGINSDIR"?\s*\n/);
    expect(c.indexOf('SetOutPath "$PLUGINSDIR\\ddv-cwd"')).toBeLessThan(c.indexOf('nsExec::'));
    // nothing is unpacked into the cwd folder: every File line names its absolute $PLUGINSDIR target
    expect(c.match(/^\s*File (?!"\/oname=\$PLUGINSDIR\\)/gm) ?? []).toEqual([]);
  });
  it('every installer-run script that compiles or dot-sources sets its cwd to SystemRoot first', () => {
    for (const f of ['guard-app-folder.ps1', 'assert-app-folder.ps1', 'setup-daemon.ps1', 'path-entry.ps1']) {
      const s = fs.readFileSync(`resources/scripts/${f}`, 'utf8').split('\n').filter((l) => !l.trim().startsWith('#')).join('\n'); // code only
      const at = s.indexOf('[System.IO.Directory]::SetCurrentDirectory($env:SystemRoot)');
      expect(at, f).toBeGreaterThan(0);
      for (const use of ['Add-Type', '. (Join-Path $PSScriptRoot']) {
        const u = s.indexOf(use);
        if (u >= 0) expect(at, `${f}: ${use}`).toBeLessThan(u);
      }
    }
  });
});
