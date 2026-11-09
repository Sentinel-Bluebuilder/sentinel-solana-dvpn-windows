// fleet-bugs W1: a wallet switch staged a new device key, then setup-daemon.ps1 kept the old home
// and deleted the staging copy, losing the new key (test-host 2026-10-24). Pins the fix's shape:
// the elevated script runs only on the VMs, so its logic is checked as text here.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const script = fs.readFileSync(path.join(__dirname, '../../resources/scripts/setup-daemon.ps1'), 'utf8');

describe('setup-daemon.ps1 on an install that already has a service home', () => {
  it('compares the staged device key with the installed one', () => {
    expect(script).toMatch(/\$Dvpnd key list --instance c0 --home \$h/);
    expect(script).toMatch(/\$old = & \$keyOf \$DaemonHome/);
    expect(script).toMatch(/\$new = & \$keyOf \$Staging/);
  });

  it('keeps the old home (moved, never deleted) and installs the staged one when the keys differ', () => {
    expect(script).toMatch(/if \(\$old -ne \$new\)/);
    expect(script).toMatch(/Move-Item -LiteralPath \$DaemonHome -Destination \$prev/);
    expect(script).toMatch(/\.prev-/);
    expect(script).not.toMatch(/Remove-Item[^\n]*\$DaemonHome/);
  });

  it('deletes the staging copy only after the service runs from the installed home', () => {
    const install = script.indexOf("Copy-Item -Path (Join-Path $Staging '*') -Destination $DaemonHome");
    const start = script.indexOf('Start-Service -Name $Service', install);
    const drop = script.indexOf('Remove-Item -LiteralPath $Staging');
    expect(install).toBeGreaterThan(0);
    expect(start).toBeGreaterThan(install);
    expect(drop).toBeGreaterThan(start);
  });

  it('stays ASCII (Windows PowerShell 5.1 reads it as cp1252)', () => {
    expect([...script].every((c) => c.charCodeAt(0) < 128)).toBe(true);
  });
});
