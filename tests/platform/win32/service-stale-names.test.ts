// Windows half of the outdated-service banner (Agent M, Mac): the installer re-runs setup-daemon on every upgrade
// (dvpnd, scripts, restart policy), so the service never runs older copies than the app. Mac/Linux return the real list.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('serviceStaleNames on Windows', () => {
  it('reports nothing stale', () => {
    const m = readFileSync('src/main/daemon/manager.ts', 'utf8');
    expect(m).toContain('export function serviceStaleNames(): string[] {\n  return [];\n}');
  });
});
