// ─── Windows system proxy for per-app split (F16a) ───
// Current user, unelevated. The user's previous proxy is saved to disk BEFORE we change it, so
// a crash is undone on the next start (restoreProxyOnStartup). Only V2Ray/Xray sessions expose
// a SOCKS endpoint.
// Set through WinINET per-connection options (resources/scripts/sysproxy.ps1), not by writing
// ProxyEnable/ProxyServer: browsers read the per-connection blob, and with only those two
// values Edge kept going direct (VM matrix 2026-10-21). Saving all four values (mode flags,
// server, bypass list, PAC URL) also brings back a user's auto-detect or PAC setup exactly.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { readJson, writeJson, storePath } from '../store';
import { log } from '../logger';
import { ShownError } from '../../shared/i18n';
import { patch } from '../app-state';
import { checkSocks5 } from '../../core/quality/socks-check';
import { scriptPath } from '../daemon/manager';

const BACKUP = 'proxy-backup.json';

/** WinINET per-connection proxy settings. flags: 1 direct, 2 proxy, 4 PAC URL, 8 auto-detect. */
export interface ProxyState { flags: number; server: string; bypass: string; pac: string }
export const PROXY_DIRECT = 1;
export const PROXY_MANUAL = 2;
export const PROXY_PAC = 4;

/** On disk. Backups written before 2026-10-21 hold the registry form (proxyEnable/proxyServer). */
interface Saved { state?: ProxyState; proxyEnable?: number; proxyServer?: string | null; ours: string }

export interface ProxyRunner { query(): Promise<ProxyState>; set(s: ProxyState): Promise<ProxyState> }

function runScript(args: string[]): Promise<ProxyState> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath('sysproxy.ps1'), ...args],
      { windowsHide: true, timeout: 30_000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(`system proxy helper failed: ${String(stderr).trim().split('\n')[0] || err.message}`));
        try { resolve(parseState(String(stdout))); } catch (e) { reject(e); }
      });
  });
}

/** The helper's last JSON line. Exported for tests. */
export function parseState(out: string): ProxyState {
  const line = out.trim().split(/\r?\n/).filter((l) => l.startsWith('{')).pop();
  if (!line) throw new Error(`system proxy helper printed no state: ${out.slice(0, 120)}`); // copy:internal
  const v = JSON.parse(line) as Partial<ProxyState>;
  return { flags: Number(v.flags) || PROXY_DIRECT, server: v.server ?? '', bypass: v.bypass ?? '', pac: v.pac ?? '' };
}

let runner: ProxyRunner = {
  query: () => runScript(['-Mode', 'query']),
  set: (s) => runScript(['-Mode', 'set', '-Json', Buffer.from(JSON.stringify(s), 'utf8').toString('base64')]),
};

/** Tests only: never touch the real proxy settings. */
export function setProxyRunner(r: ProxyRunner): void {
  runner = r;
}

let socksCheck: typeof checkSocks5 = checkSocks5;
/** Tests only: replace the SOCKS liveness check. */
export function setSocksCheck(c: typeof checkSocks5): void {
  socksCheck = c;
}

/**
 * What we set: a PAC script sending every proxy-aware app to the session's SOCKS5, local names direct.
 * Q0537 (DVPN-WIN, Edge headless, kill switch persist + V2Ray/Xray proxy): the manual entry
 * 'socks=host:port' is SOCKS v4 to Chromium, which resolves names ITSELF; the kill switch blocks that
 * DNS, so every Chromium browser was offline while the app said "Protected in browsers". "SOCKS5" from a
 * PAC resolves names through the proxy (node exit on both cores, and no DNS leak with the kill switch
 * off either). A data: URL needs no local server; Edge ignores file: PAC URLs.
 */
export function pacFor(endpoint: string): string {
  return `${PAC_PREFIX}function FindProxyForURL(u,h){if(isPlainHostName(h)||h=="localhost"||shExpMatch(h,"127.*")||h=="[::1]")return "DIRECT";return "SOCKS5 ${endpoint}";}`;
}
export const PAC_PREFIX = 'data:application/x-ns-proxy-autoconfig,';
const OUR_PAC = /^data:application\/x-ns-proxy-autoconfig,.*return "SOCKS5 127\.0\.0\.1:\d{2,5}";\}$/;

export function oursFor(endpoint: string): ProxyState {
  return { flags: PROXY_DIRECT | PROXY_PAC, server: '', bypass: '', pac: pacFor(endpoint) };
}

/** No proxy: what a user gets back when the only thing to restore was our own proxy. */
export const DIRECT_STATE: ProxyState = { flags: PROXY_DIRECT, server: '', bypass: '', pac: '' };

/**
 * A proxy this app set: SOCKS on loopback, any port (Q0281). A leftover of ours must never be saved, or
 * restored, as "what the user had": once one was (a restore that failed, or a cleanup that reset only
 * the ProxyEnable registry value while the per-connection setting kept our SOCKS), every later
 * "proxy off" put the proxy back on, and with no session every WinINET app had no internet (wx1, twice).
 */
export function isOurs(s: Pick<ProxyState, 'flags' | 'server'> & { pac?: string }): boolean {
  // The PAC form (Q0537), or the manual SOCKS form older versions set: a leftover of those is still ours.
  if ((s.flags & PROXY_PAC) && OUR_PAC.test((s.pac ?? '').trim())) return true;
  return !!(s.flags & PROXY_MANUAL) && /^socks=127\.0\.0\.1:\d{2,5}$/.test(s.server.trim());
}

/** The saved state in the current form (old registry-form backups are converted). Our own proxy reads as direct. */
export function savedState(saved: Saved): ProxyState {
  const s = saved.state ?? { flags: PROXY_DIRECT | (saved.proxyEnable ? PROXY_MANUAL : 0), server: saved.proxyServer ?? '', bypass: '', pac: '' };
  return isOurs(s) ? DIRECT_STATE : s;
}

/** `endpoint` = the session's proxy_endpoint, e.g. "127.0.0.1:1080". */
export async function setSystemProxy(endpoint: string): Promise<void> {
  if (!/^127\.0\.0\.1:\d{2,5}$/.test(endpoint)) throw new Error(`refusing non-loopback proxy endpoint ${endpoint}`); // copy:internal
  // A dead proxy as the system proxy cuts every app's internet: prove it works here first.
  const live = await socksCheck(endpoint);
  if (!live.ok) throw new ShownError('The VPN\'s SOCKS proxy is not answering on this computer ({reason}). Nothing was changed.', { reason: live.reason });
  const ours = oursFor(endpoint);
  if (!fs.existsSync(storePath(BACKUP))) {
    const before = await runner.query();
    if (isOurs(before)) log.warn('system proxy: found our own SOCKS proxy left on; saving direct as the setting to restore', { server: before.server });
    const saved: Saved = { state: isOurs(before) ? DIRECT_STATE : before, ours: ours.pac };
    writeJson(BACKUP, saved);
  }
  const now = await runner.set(ours);
  if (now.pac !== ours.pac || !(now.flags & PROXY_PAC)) throw new ShownError('Windows did not accept the proxy setting. Nothing else was changed.');
  patch({ proxyActive: true });
  log.info('system proxy set', { endpoint });
}

export function systemProxyActive(): boolean {
  return fs.existsSync(storePath(BACKUP));
}

/**
 * Q0351: whether our proxy is really still set. The user (Windows Settings, another tool) can turn it
 * off outside the app; Home then said apps use the VPN while they went direct. Reads the live setting.
 */
export async function systemProxyLive(): Promise<boolean> {
  if (!systemProxyActive()) return false;
  return isOurs(await runner.query());
}

/**
 * Put back exactly what the user had. No-op when we never set it. `orphan`: an explicit "proxy off" also
 * clears a SOCKS proxy of ours left on with no backup (Q0281); app start and session end skip that query.
 */
export async function clearSystemProxy(opts: { orphan?: boolean } = {}): Promise<void> {
  const saved = readJson<Saved | null>(BACKUP, null);
  if (!saved) {
    if (!opts.orphan) return;
    const now = await runner.query();
    if (!isOurs(now)) return;
    await runner.set(DIRECT_STATE);
    patch({ proxyActive: false });
    log.warn('system proxy: our SOCKS proxy was on with no backup; set to direct', { server: now.server });
    return;
  }
  try {
    // Only undo if the value is still ours — the user may have changed it since.
    const now = await runner.query();
    if (isOurs(now)) await runner.set(savedState(saved));
    else log.info('system proxy changed by someone else since; left as it is', { flags: now.flags });
    fs.rmSync(storePath(BACKUP), { force: true });
    patch({ proxyActive: false });
    log.info('system proxy restored');
  } catch (err) {
    log.error('system proxy restore failed', err);
    throw err;
  }
}

export const restoreProxyOnStartup = clearSystemProxy;
