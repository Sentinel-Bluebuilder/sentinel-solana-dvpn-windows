// ─── R1 (rc9-c2, macOS testing audit): the app folder is owned and locked by administrators BEFORE any elevated script ───
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const nsh = fs.readFileSync(path.resolve('build/installer.nsh'), 'utf8');
const inst = nsh.slice(nsh.indexOf('!macro customInstall'), nsh.indexOf('!macroend', nsh.indexOf('!macro customInstall')));
const sd = fs.readFileSync(path.resolve('resources/scripts/setup-daemon.ps1'), 'utf8');

describe('installer.nsh customInstall order', () => {
  it('sets the owner to Administrators first, then the lock, both before every script run from $INSTDIR', () => {
    const owner = inst.indexOf('icacls "$INSTDIR" /setowner *S-1-5-32-544 /T /C /Q');
    const lock = inst.indexOf('icacls "$INSTDIR" /inheritance:r');
    expect(owner).toBeGreaterThan(-1);
    expect(lock).toBeGreaterThan(owner);
    for (const script of ['scripts\\install-deps.ps1', 'scripts\\path-entry.ps1', 'scripts\\setup-daemon.ps1', 'bin\\devnet-dvpn.cmd']) { // the command lines, not the comment
      const at = inst.indexOf(script);
      expect(at, script).toBeGreaterThan(lock);
    }
  });
  it('every icacls call and the verify abort the install (no warn-and-continue)', () => {
    const blocks = inst.slice(inst.indexOf('/setowner'), inst.indexOf('scripts\\install-deps.ps1'));
    expect(blocks.match(/\$\{If\} \$0 != "0"[\s\S]*?Abort/g)?.length).toBe(6); // R1b (rc9-d): 5 checked icacls calls + the verify
  });
});

describe('setup-daemon.ps1 Assert-AdminOnly checks the owner', () => {
  it('reads the owner SID and refuses one that is not an admin SID, before the ACE loop', () => {
    const fn = sd.slice(sd.indexOf('function Assert-AdminOnly'));
    expect(fn).toMatch(/\$acl\.GetOwner\(\[System\.Security\.Principal\.SecurityIdentifier\]\)\.Value/);
    expect(fn.indexOf('Test-AdminOwner $ownerSid')).toBeLessThan(fn.indexOf('foreach ($r in $acl.GetAccessRules'));
    expect(sd.indexOf('function Test-AdminOwner')).toBeLessThan(sd.indexOf("if ($MyInvocation.InvocationName -eq '.') { return }"));
  });
});
