// ─── CODE-AUDIT E13: the Windows settings apply counts a service it had to start as up ───
// Moved from tests/unit/device-topup-once.test.ts: it pins src/main/daemon/settings.ts, the Windows
// staged-file + one-UAC-copy apply, which the other OS ports do not share.
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';

describe('E13: a settings apply that went in counts the service as up when it had to be started', () => {
  it("'started' counts as running", () => {
    const src = fs.readFileSync('src/main/daemon/settings.ts', 'utf8');
    expect(src).toContain("const running = svc === 'running' || svc === 'started';");
  });
});
