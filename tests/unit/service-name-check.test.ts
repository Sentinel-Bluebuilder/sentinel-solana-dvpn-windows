// ─── rc9-c D5 (macOS testing audit): an elevated script acts only on this app's service ───
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const CHECK = "if ($Service -notmatch '^sentinel-dvpnd\\$([a-z0-9]+)$') { throw \"unexpected service name $Service\" }";
const re = /^sentinel-dvpnd\$([a-z0-9]+)$/;

describe('service-name check', () => {
  for (const f of ['grant-pipe.ps1', 'setup-daemon.ps1', 'apply-daemon-config.ps1', 'service-user-start.ps1']) {
    it(`${f} refuses another service before it touches one`, () => {
      const s = fs.readFileSync(path.resolve('resources/scripts', f), 'utf8');
      const at = s.indexOf(CHECK);
      expect(at, f).toBeGreaterThan(-1);
      for (const use of ['Stop-Service', 'Get-Service', 'sc.exe']) {
        const u = s.indexOf(use);
        if (u >= 0) expect(at, `${f} ${use}`).toBeLessThan(u);
      }
    });
  }
  it('the pattern: ours in, anything else out', () => {
    expect(re.test('sentinel-dvpnd$c0')).toBe(true);
    for (const bad of ['WinDefend', 'sentinel-dvpnd$c0;x', 'sentinel-dvpnd$C0', 'sentinel-dvpnd', 'x sentinel-dvpnd$c0']) expect(re.test(bad), bad).toBe(false);
  });
});
