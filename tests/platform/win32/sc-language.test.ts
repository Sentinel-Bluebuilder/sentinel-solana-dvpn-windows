// ─── CODE-AUDIT L-30 (main side): sc.exe text in the language of Windows ───
// The labels STATE / FAILED are translated (German: STATUS / FEHLER); the numbers and state names are not.
import fs from 'node:fs';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/main/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../../src/main/daemon/manager', () => ({ scriptPath: (s: string) => s }));
vi.mock('../../../src/main/system/elevate', () => ({ runElevated: vi.fn() }));

const de = (name: string, n: number, word: string): string => `\r\nSERVICE_NAME: ${name}\r\nDISPLAY_NAME: x\r\n        TYP                : 10  WIN32_OWN_PROCESS\r\n        STATUS             : ${n}  ${word}\r\n        WIN32_EXITCODE     : 0  (0x0)\r\n`;

describe('sc.exe in German', () => {
  it('our running tunnel services are found', async () => {
    const { parseTunnelServices } = await import('../../../src/main/system/tunnels');
    const out = [de('WireGuardTunnel$dvpn-c0', 4, 'RUNNING'), de('AmneziaWGTunnel$dvpn-c1', 2, 'START_PENDING'), de('WireGuardTunnel$dvpn-c2', 1, 'STOPPED'), de('Other', 4, 'RUNNING')].join('\r\n');
    expect(parseTunnelServices(out)).toEqual(['WireGuardTunnel$dvpn-c0', 'AmneziaWGTunnel$dvpn-c1']);
  });
  it('no English-only sc.exe match is left in main/', () => {
    for (const f of ['src/main/daemon/manager.ts', 'src/main/daemon/migrate-run.ts', 'src/main/system/tunnels.ts']) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src).not.toMatch(/\/FAILED \d|\/STATE\\s/);
    }
  });
});
