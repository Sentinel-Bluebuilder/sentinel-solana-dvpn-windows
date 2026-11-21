// ─── rc9-f2: B41 (both session-active rows), the guard never leaves a weakened folder, the binary checks ───
import fs from 'node:fs';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/main/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const { commandNext } = await import('../../src/cli/action-hint');
const { daemonErrorCopy } = await import('../../src/core/daemon/link-copy');
const DOC = fs.readFileSync('docs/AGENT-COMMANDS.md', 'utf8');
const rows = DOC.split('\n').filter((l) => l.startsWith('| `session-active` |'));

describe('B41: every session-active row and the CLI next', () => {
  it('both rows (connect and the service) name agent status --json, never an end-then-reconnect', () => {
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r).toContain('`<cli> agent status --json`');
      expect(r).not.toMatch(/agent down --yes, then|<cli> disconnect`, then/);
    }
  });
  it('the service-side answer: the app button "Disconnect" becomes agent status --json on the command line', () => {
    const dc = daemonErrorCopy('rpc error: code = FailedPrecondition desc = a session is already active');
    expect(dc?.code).toBe('session-active');
    expect(commandNext(dc?.action, dc?.message ?? '')).toBe('devnet-dvpn agent status --json');
  });
});

describe('rc9-f2: guard and setup-daemon', () => {
  const g = fs.readFileSync('resources/scripts/guard-app-folder.ps1', 'utf8');
  it('one lock routine; a folder that cannot be replaced is locked before the refusal', () => {
    expect(g.match(/'\/setowner', '\*S-1-5-32-544'/g)?.length).toBe(1);
    expect(g).toMatch(/try \{ Remove-Item -LiteralPath \$full -Force \} catch \{[\s\S]{0,200}\$lock = Invoke-AppDirLock \$full/);
  });
  it('setup-daemon checks the daemon binary and every BinRoot exe, not only their folders', () => {
    const s = fs.readFileSync('resources/scripts/setup-daemon.ps1', 'utf8');
    const at = s.indexOf('  Assert-AdminOnlyChain $binDir');
    expect(s.indexOf('  Assert-AdminOnly $Dvpnd\n')).toBeGreaterThan(at);
    expect(s).toContain("Get-ChildItem -LiteralPath $BinRoot -Recurse -Force -File -Filter '*.exe') { Assert-AdminOnly $exe.FullName }");
  });
  it('ASCII only in the changed scripts (PowerShell 5.1 reads cp1252)', () => {
    for (const f of ['guard-app-folder.ps1', 'guard-app-folder.Tests.ps1', 'setup-daemon.ps1', 'setup-daemon.Tests.ps1']) {
      expect(/[^\x00-\x7f]/.test(fs.readFileSync(`resources/scripts/${f}`, 'utf8')), f).toBe(false);
    }
  });
});
