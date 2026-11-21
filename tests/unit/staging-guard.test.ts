// ─── rc9-c D1-D3 (macOS testing root-step audit, Windows port): the elevated scripts never trust the staging folder ───
// Static: ctl has no PowerShell. The behaviour (a junction inside staging, a linked config.toml) is the Pester file
// resources/scripts/staging-guard.Tests.ps1, run as SYSTEM on w11 by Windows testing.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (f: string): string => fs.readFileSync(path.resolve('resources/scripts', f), 'utf8');
const guardPath = path.resolve('resources/scripts/staging-guard.ps1');

describe('staging-guard.ps1', () => {
  it('exists, ASCII, opens every staged file without following a link and checks it is that same plain file', () => {
    expect(fs.existsSync(guardPath)).toBe(true);
    const g = read('staging-guard.ps1');
    expect(/[^\x00-\x7f]/.test(g)).toBe(false);
    expect(g).toMatch(/FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000/);
    expect(g).toMatch(/GetFinalPathNameByHandleW/);
    expect(g).toMatch(/info\.Links != 1/);
    for (const code of ['STAGING-PATH', 'STAGING-LINK', 'STAGING-SIZE']) expect(g).toContain(`${code}:`);
    expect(g).toMatch(/\[System\.IO\.Directory\]::CreateDirectory\(\$dir, \$acl\)/); // snapshot folder born admin-only
    expect(g).toMatch(/\[System\.IO\.Directory\]::Delete\(\$Path, \$true\)/);
    const code = g.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n'); // the comments name the old way
    expect(code).not.toMatch(/Remove-Item[^\n]*-Recurse/);
    // rc9-c2 (Windows testing w11 Pester): links removed one by one before the tree; codes not wrapped by PowerShell.
    const rm = code.slice(code.indexOf('function Remove-StagingTree'));
    expect(rm.indexOf('[System.IO.Directory]::Delete($e.FullName)')).toBeGreaterThan(-1);
    expect(rm.indexOf('[System.IO.Directory]::Delete($e.FullName)')).toBeLessThan(rm.indexOf('[System.IO.Directory]::Delete($Path, $true)'));
    expect(code).toMatch(/catch \{ throw \$_\.Exception\.GetBaseException\(\)\.Message \}/);
  });
});

describe('setup-daemon.ps1 (D1/D2/D3)', () => {
  const s = read('setup-daemon.ps1');
  it('dot-sources the guard before the dot-source stop, and checks the staging path', () => {
    expect(s.indexOf(". (Join-Path $PSScriptRoot 'staging-guard.ps1')")).toBeGreaterThan(-1);
    expect(s.indexOf(". (Join-Path $PSScriptRoot 'staging-guard.ps1')")).toBeLessThan(s.indexOf("if ($MyInvocation.InvocationName -eq '.') { return }"));
    expect(s).toMatch(/\$Staging = Assert-StagingPath \$Staging @\('daemon-staging', 'daemon-switch'\)/);
  });
  it('never removes a caller-given folder with Remove-Item -Recurse, and never reads the staging folder after the snapshot', () => {
    expect(s).not.toMatch(/Remove-Item -LiteralPath \$Staging -Recurse/);
    expect(s).not.toMatch(/Join-Path \$Staging '\*'/);
    expect(s).not.toMatch(/& \$keyOf \$Staging/);
    const snapAt = s.indexOf('$snap = Copy-StagingSnapshot $Staging');
    expect(snapAt).toBeGreaterThan(-1);
    const after = s.slice(snapAt + 40);
    expect(after.match(/\$Staging\b/g) ?? []).toEqual(['$Staging', '$Staging', '$Staging', '$Staging']); // two messages, the removal guard and its call
  });
});

describe('apply-daemon-config.ps1 (D2/D3)', () => {
  const a = read('apply-daemon-config.ps1');
  it('checks the staged path and reads each file once into the snapshot before any check', () => {
    expect(a).toMatch(/\$Staged = Assert-StagingPath \$Staged @\('staged'\)/);
    const snapAt = a.indexOf('$Staged = $snap');
    expect(snapAt).toBeGreaterThan(-1);
    expect(snapAt).toBeLessThan(a.indexOf("throw \"missing staged file"));
    expect(a.slice(0, snapAt)).toMatch(/Copy-StagedFile \$f \(Join-Path \$snap \$n\) 65536/);
  });
});
