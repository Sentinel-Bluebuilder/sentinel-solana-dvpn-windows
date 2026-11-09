// ─── Q0267: the Handshake preset keeps one non-HNS fallback ───
import { describe, expect, it } from 'vitest';
import { DNS_PRESETS, dnsLabel, upgradeDnsServers } from '../../src/core/daemon/dns-presets';

const OLD_HANDSHAKE = ['103.196.38.38', '103.196.38.39'];

describe('Handshake DNS preset (Q0267)', () => {
  it('lists both HNSDNS servers first, then 1.1.1.1', () => {
    expect(DNS_PRESETS.handshake.servers).toEqual(['103.196.38.38', '103.196.38.39', '1.1.1.1']);
  });

  it('a list saved before the change becomes the current preset and keeps its name', () => {
    expect(upgradeDnsServers(OLD_HANDSHAKE)).toEqual(DNS_PRESETS.handshake.servers);
    expect(upgradeDnsServers(OLD_HANDSHAKE)).not.toBe(DNS_PRESETS.handshake.servers); // a copy
    expect(dnsLabel(upgradeDnsServers(OLD_HANDSHAKE))).toBe(DNS_PRESETS.handshake.label);
  });

  it('every other list is left alone (custom order, other presets, empty)', () => {
    for (const l of [['103.196.38.39', '103.196.38.38'], ['103.196.38.38'], DNS_PRESETS.cloudflare.servers, ['5.5.5.5'], undefined]) {
      expect(upgradeDnsServers(l)).toBe(l);
    }
  });

  it('every preset fits dvpnd and the settings check (1 to 4 servers)', () => {
    for (const p of Object.values(DNS_PRESETS)) expect(p.servers.length).toBeGreaterThanOrEqual(1);
    for (const p of Object.values(DNS_PRESETS)) expect(p.servers.length).toBeLessThanOrEqual(4);
  });
});
