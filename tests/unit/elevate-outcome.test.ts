// An admin step that wrote no result: a time-out must not be reported as a declined prompt.
import { describe, expect, it } from 'vitest';
import { elevateTimeoutMs, noResultOutcome } from '../../src/main/system/elevate';

describe('noResultOutcome', () => {
  it('a step cut off by the time limit says so, with the limit', () => {
    const r = noResultOutcome(true, 180_000);
    expect(r.status).toBe('error');
    expect(r.detail).toMatch(/did not finish within 180 s/);
    expect(r.detail).not.toMatch(/declined/);
  });
  it('no result without a time-out is still a declined or closed prompt', () => {
    expect(noResultOutcome(false, 60_000)).toEqual({ status: 'cancelled', detail: 'The Windows permission prompt was declined or closed.' });
  });
});

describe('admin step timeout (DVPN_ELEVATE_TIMEOUT_MS, emulated ARM64 test VM)', () => {
  it('defaults to 120 s and takes only a sane override', () => {
    expect(elevateTimeoutMs({})).toBe(120_000);
    expect(elevateTimeoutMs({ DVPN_ELEVATE_TIMEOUT_MS: '420000' })).toBe(420_000);
    expect(elevateTimeoutMs({ DVPN_ELEVATE_TIMEOUT_MS: 'abc' })).toBe(120_000);
    expect(elevateTimeoutMs({ DVPN_ELEVATE_TIMEOUT_MS: '5' })).toBe(120_000);
    expect(elevateTimeoutMs({ DVPN_ELEVATE_TIMEOUT_MS: '99999999' })).toBe(120_000);
  });
});

describe('a timed-out admin step that still applied (fleet-bugs #3)', () => {
  it('waits for the step’s own result file, then gives up', async () => {
    const { waitForFile, resultGraceMs } = await import('../../src/main/system/elevate');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const f = path.join(os.tmpdir(), `test-host${process.pid}.json`);
    fs.rmSync(f, { force: true });
    setTimeout(() => fs.writeFileSync(f, '{}'), 60);
    expect(await waitForFile(f, 2000, 10)).toBe(true);
    fs.rmSync(f, { force: true });
    expect(await waitForFile(f, 50, 10)).toBe(false);
    expect(resultGraceMs({})).toBe(180_000);
    expect(resultGraceMs({ DVPN_ELEVATE_GRACE_MS: '0' })).toBe(0);
    expect(resultGraceMs({ DVPN_ELEVATE_GRACE_MS: '-1' })).toBe(180_000);
  });
});
