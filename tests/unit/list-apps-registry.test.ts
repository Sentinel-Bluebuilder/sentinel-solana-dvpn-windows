// ─── rc9-f W-WIN-2 (Windows testing audit, M): the split-tunnel picker's App Paths roots are real registry paths ───
// 2c76fd56f wrote them without backslashes ('HKLM:SOFTWAREMicrosoft...'); Get-ChildItem failed on each and
// SilentlyContinue hid it, so the App Paths list was always empty.
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';

const ROOTS = [
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths',
  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths',
];

describe('W-WIN-2: list-apps.ps1 App Paths', () => {
  it('the three roots, with their backslashes', () => {
    const ps = fs.readFileSync('resources/scripts/list-apps.ps1', 'utf8');
    for (const r of ROOTS) expect(ps).toContain(`'${r}'`);
  });
  it('no shipped script names a registry drive without a backslash after it', () => {
    const bad: string[] = [];
    for (const f of fs.readdirSync('resources/scripts').filter((x) => x.endsWith('.ps1'))) {
      const s = fs.readFileSync(`resources/scripts/${f}`, 'utf8');
      for (const m of s.matchAll(/\bHK(?:LM|CU|CR|U):(?![\\/])[A-Za-z]/g)) bad.push(`${f}: ${s.slice(m.index, m.index + 40)}`);
    }
    expect(bad).toEqual([]);
  });
});
