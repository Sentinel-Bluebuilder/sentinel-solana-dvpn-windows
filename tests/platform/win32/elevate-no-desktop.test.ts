// ─── WIN-W4 (the agent tools rc.9, Windows testing audit W-4): RunAs with no desktop is needs-admin, never "declined" ───
// A standard user over SSH (or a task with no desktop) reached `Start-Process -Verb RunAs`. It throws at once
// ("This operation requires an interactive window station"), no prompt ever shows, and the step wrote no result,
// so the agent was told it had declined a prompt it never saw.
import { describe, expect, it } from 'vitest';
import { elevatedOuterCommand, runasFailure, noResultOutcome } from '../../../src/main/system/elevate';

describe('WIN-W4: the RunAs branch reports its own failure', () => {
  it('the RunAs branch is caught, prints runas-failed on stderr and exits 87; the admin branch is unchanged', () => {
    const c = elevatedOuterCommand('-NoProfile -File "C:/x.ps1"');
    expect(c).toContain("else { try { $p = Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList $a } catch { [Console]::Error.WriteLine('runas-failed: ' + $_.Exception.Message); exit 87 } }");
    expect(c).toContain('if ($admin) { $p = Start-Process -FilePath powershell.exe -WindowStyle Hidden -Wait -PassThru -ArgumentList $a }');
    // still ONE if/else element (the 2026-11-11 'else' bug)
    expect(c.split('; ').filter((s) => s.startsWith('else'))).toEqual([]);
  });

  it('runas-failed on stderr: needs-admin, the elevated-shell sentence, nothing changed', () => {
    const r = runasFailure('runas-failed: This operation requires an interactive window station.\r\n');
    expect(r).toMatchObject({ status: 'error', code: 'needs-admin' });
    expect(r?.detail).toMatch(/could not show the administrator prompt here/);
    expect(r?.detail).toMatch(/elevated shell or an administrator SSH login/);
    expect(r?.detail).toMatch(/Nothing was changed\./);
    expect(r?.detail).not.toMatch(/declined/);
  });

  it('negative controls: other stderr is not needs-admin; no result and no runas-failed stays "declined or closed"', () => {
    expect(runasFailure('')).toBeNull();
    expect(runasFailure('The operation was canceled by the user.')).toBeNull();
    expect(noResultOutcome(false, 60_000).status).toBe('cancelled');
  });
});
