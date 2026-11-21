// ─── R1b (rc9-d, Windows testing w11): the app-folder lock is 5 checked calls and a verify, on every install ───
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { asciiDetail } from '../../src/cli/daemon-cmd';

const nsh = fs.readFileSync(path.resolve('build/installer.nsh'), 'utf8');
const inst = nsh.slice(nsh.indexOf('!macro customInstall'), nsh.indexOf('!macroend', nsh.indexOf('!macro customInstall')));
const CALLS = [
  'icacls "$INSTDIR" /setowner *S-1-5-32-544 /T /C /Q',
  'icacls "$INSTDIR" /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F *S-1-5-32-545:(OI)(CI)RX /Q',
  'icacls "$INSTDIR" /inheritance:r /Q',
  'icacls "$INSTDIR" /remove:g *S-1-1-0 *S-1-5-11 /Q',
  'icacls "$INSTDIR\\*" /reset /T /C /Q',
];

describe('R1b: the lock', () => {
  it('the 5 calls, in order, each its own call', () => {
    let at = -1;
    for (const c of CALLS) {
      const i = inst.indexOf(`nsExec::ExecToLog '${c}'`);
      expect(i, c).toBeGreaterThan(at);
      at = i;
    }
  });
  it('the combined call that left an empty file ACL is gone', () => {
    expect(inst).not.toMatch(/\/inheritance:r \/grant:r/);
  });
  it('every call is checked and refuses with a non-zero error level', () => {
    const lock = inst.slice(inst.indexOf(CALLS[0]), inst.indexOf('scripts\\install-deps.ps1'));
    expect(lock.match(/Pop \$0\s+\$\{If\} \$0 != "0"[\s\S]*?SetErrorLevel 2\s+Abort/g)?.length).toBe(6); // 5 calls + the verify
    expect(lock).not.toMatch(/MB_ICONSTOP[^\n]*\n\s+Abort/); // no Abort without the error level
  });
});

describe('R1b: the verify', () => {
  it('runs assert-app-folder.ps1 from $PLUGINSDIR on $INSTDIR, after the lock and before install-deps', () => {
    const v = inst.indexOf('-File "$PLUGINSDIR\\assert-app-folder.ps1" -Dir "$INSTDIR"');
    expect(v).toBeGreaterThan(inst.indexOf(CALLS[4]));
    expect(v).toBeLessThan(inst.indexOf('scripts\\install-deps.ps1'));
    expect(inst.indexOf('CopyFiles /SILENT "$INSTDIR\\resources\\resources\\scripts\\assert-app-folder.ps1" "$PLUGINSDIR"')).toBeLessThan(v);
  });
  it('on EVERY install: the verify is outside the not-Program-Files block, and nothing tests for a new folder', () => {
    const block = inst.slice(inst.indexOf('${AndIf} $4 != "$PROGRAMFILES\\"'), inst.indexOf('${EndIf}', inst.indexOf(CALLS[4]) + 200) + 8);
    expect(block).not.toContain('assert-app-folder.ps1');
    expect(inst).not.toMatch(/IfFileExists[^\n]*\$INSTDIR[^\n]*\n[^\n]*setowner/);
  });
  it('the script checks the owner and ACEs (Assert-AdminOnly) and that SYSTEM keeps access to every file', () => {
    const ps = fs.readFileSync(path.resolve('resources/scripts/assert-app-folder.ps1'), 'utf8');
    expect(ps).toMatch(/Assert-AdminOnly \$Dir/);
    expect(ps).toMatch(/Get-ChildItem -LiteralPath \$Dir -Recurse -Force/);
    expect(ps).toMatch(/'S-1-5-18'/);
    expect(ps).toMatch(/exit 1/);
  });
});

describe('rc9-d: doctor details are ASCII', () => {
  it('the grant detail arrow becomes ">"; other non-ASCII is dropped', () => {
    expect(asciiDetail('Set one: Wallet → Set spending limit, or x.')).toBe('Set one: Wallet > Set spending limit, or x.');
    expect(asciiDetail('a — b …')).toBe('a - b ...');
    expect(/[^\x20-\x7e]/.test(asciiDetail('été ✓'))).toBe(false);
  });
  it('doctor maps every row through it before printing', () => {
    const s = fs.readFileSync(path.resolve('src/cli/daemon-cmd.ts'), 'utf8');
    expect(s).toMatch(/for \(const r of rows\) r\.detail = asciiDetail\(r\.detail\);\n\s+o\.print\(rows\.map/);
  });
});
