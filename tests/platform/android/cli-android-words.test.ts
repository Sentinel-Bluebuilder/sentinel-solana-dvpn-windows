// ─── Q0497: the CLI command list on Android has no desktop words and no desktop-only commands ───
import { describe, expect, it } from 'vitest';
import { CATALOGUE, entriesFor } from '../../../src/cli/catalogue';

const DESKTOP = /this computer|administrator|admin prompt|PowerShell|Windows|system proxy/i;

describe('Q0497 Android CLI wording', () => {
  it('every command Android shows reads as a phone (androidSummary where the summary is desktop)', () => {
    const shown = CATALOGUE.filter((e) => !e.desktopOnly).map((e) => ({ cmd: e.cmd, text: e.androidSummary ?? e.summary }));
    expect(shown.filter((e) => DESKTOP.test(e.text)).map((e) => `${e.cmd}: ${e.text}`)).toEqual([]);
  });

  it('the proxy commands and the service install/migrate commands are desktop only', () => {
    const off = CATALOGUE.filter((e) => e.desktopOnly).map((e) => e.cmd).sort();
    expect(off).toEqual(['daemon migrate', 'daemon uninstall', 'proxy browser', 'proxy off', 'proxy on', 'proxy status']);
  });

  it('the desktop keeps every command and its own wording (negative control)', () => {
    expect(CATALOGUE.find((e) => e.cmd === 'proxy on')?.summary).toMatch(/this computer/);
    expect(CATALOGUE.find((e) => e.cmd === 'daemon drivers')?.summary).toMatch(/this computer/);
  });

  it('entriesFor(android) is what help and the CLI page print', () => {
    const h = entriesFor(true).map((e) => `${e.usage} ${e.summary}`).join('\n');
    expect(entriesFor(false)).toBe(CATALOGUE);
    expect(h).not.toMatch(/this computer/);
    expect(h).not.toMatch(/^proxy on/m);
    expect(h).toMatch(/protocol programs this phone needs/);
  });
});
