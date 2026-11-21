// ─── Daemon settings (D4, F14, F15, F16b, F18) ───
// Kill switch, DNS, allow_lan, basis/escrow/prepay, the daemon's RPC URL and V2Ray/Xray
// whole-device mode live in the daemon's own TOML, not in gRPC. cb33 keeps them in ONE instance
// config.toml (V2Ray/Xray: <instance>/<service>/config.toml). We read it when Windows lets a
// standard user read it, render + validate a new one (core/daemon/config), stage it under
// userData, and apply with one UAC prompt + service restart.
import fs from 'node:fs';
import path from 'node:path';
import { parseConfig, parseWholeDevice, readToml, renderConfig, renderServiceConfig, TUN_SERVICES, validateForApply, type DaemonSettings } from '../../core/daemon/config';
import { CONFIG_FILE } from '../../core/daemon/layout';
import { splitNotApplied } from '../../core/session/state';
import { DAEMON_SERVICE, appUserAccount, binPath, DEFAULT_DAEMON_HOME, daemonInfo, deviceRecord, relinkDaemon, scriptPath, startServiceIfStopped } from './manager';
import { runElevated } from '../system/elevate';
import { log } from '../logger';
import { getHost } from '../host';
import { PREPAY_CAP_BYTES, PREPAY_CAP_SECONDS, prepayOverCap } from '../../shared/prepay-cap';

function home(): string {
  return deviceRecord()?.home ?? DEFAULT_DAEMON_HOME;
}

/** V2Ray/Xray service configs that exist (a service list without them has none). */
function readServiceConfigs(): Partial<Record<(typeof TUN_SERVICES)[number], string>> {
  const out: Partial<Record<(typeof TUN_SERVICES)[number], string>> = {};
  for (const s of TUN_SERVICES) {
    const f = path.join(home(), s, CONFIG_FILE);
    try {
      if (fs.existsSync(f)) out[s] = fs.readFileSync(f, 'utf8');
    } catch (err) {
      log.warn('service config not readable as this user', { service: s, err: (err as Error).message });
    }
  }
  return out;
}

// Q0544 (DVPN-LINUX, a spot preemption cut a root write in place): a config that exists but is empty is never
// read as 'no settings'; an Apply would render a whole config from nothing.
let lastReadEmpty = false;
export { EMPTY_SETTINGS_COPY } from '../../shared/settings-copy';
import { EMPTY_SETTINGS_COPY } from '../../shared/settings-copy';
import { tr } from '../../shared/i18n';

function readLive(): string | null {
  lastReadEmpty = false;
  try {
    const text = fs.readFileSync(path.join(home(), CONFIG_FILE), 'utf8');
    if (!text.trim()) {
      lastReadEmpty = true;
      log.warn('daemon config is empty; not using it', { file: path.join(home(), CONFIG_FILE) });
      return null;
    }
    return text;
  } catch (err) {
    // Windows VM 2026-11-15 (c975868): 79 of these in 65 s on a fresh install, one per read. A file that is not
    // there yet (the service is not installed) is not a warning; any reason is logged once, then once a minute.
    const msg = (err as Error).message;
    const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
    const t = Date.now();
    if (msg !== lastUnreadable.msg || t - lastUnreadable.at >= 60_000) {
      lastUnreadable = { msg, at: t };
      log[missing ? 'info' : 'warn'](missing ? 'no daemon config yet (the VPN service is not installed)' : 'daemon config not readable as this user', { err: msg });
    }
    return null;
  }
}
let lastUnreadable = { msg: '', at: 0 };

/**
 * True when this V2Ray/Xray session runs in whole-device mode (Windows TUN): every app is
 * already covered, so the app must not also set the system proxy (that would send proxy-aware
 * apps through the SOCKS port whatever the split tunnelling choice says).
 */
export function serviceUsesTun(service: string | null | undefined): boolean {
  if (process.platform !== 'win32' || !service) return false;
  const s = service.toLowerCase();
  if (!(TUN_SERVICES as readonly string[]).includes(s)) return false;
  const toml = readServiceConfigs()[s as (typeof TUN_SERVICES)[number]];
  return toml !== undefined && parseWholeDevice([toml]) === true;
}

/**
 * The split tunnelling dvpnd applies to a session of this protocol: [split] from the client
 * config, filtered by what this dvpnd build does (splitNotApplied). null = full tunnel.
 */
export function splitForSession(service: string | null | undefined): 'include' | 'exclude' | null {
  const live = readLive();
  if (!live || !service) return null;
  const mode = readToml(live, 'split', 'mode');
  if (mode !== 'include' && mode !== 'exclude') return null;
  const list = (k: string): string[] => { const v = readToml(live, 'split', k); return Array.isArray(v) ? v : []; };
  const apps = list('apps');
  if (!apps.length && !list('routes').length) return null;
  const why = splitNotApplied({
    daemonVersion: daemonInfo().version,
    service,
    killSwitch: String(readToml(live, 'network', 'kill_switch') ?? 'on'),
    wholeDevice: (TUN_SERVICES as readonly string[]).includes(service.toLowerCase()) ? serviceUsesTun(service) : undefined,
    hasApps: apps.length > 0,
    platform: process.platform,
  });
  if (why) log.info('split tunnelling not in effect for this session', { service, why });
  return why ? null : mode;
}

/**
 * True when the live file equals what we staged and the service is running: the change applied
 * even though the admin step reported an error. Line endings are ignored. Exported for tests.
 */
export function appliedAnyway(staged: string, live: string | null, running: boolean): boolean {
  if (live === null || !running) return false;
  const n = (t: string) => t.replace(/\r\n/g, '\n').trim();
  return n(staged) === n(live);
}

/** missing = the service was never set up on this computer (no config file), not a permission problem. */
export function getDaemonSettings(): { readable: boolean; missing?: boolean; empty?: boolean; settings: Partial<DaemonSettings> } {
  const live = readLive();
  if (live === null) return { readable: false, missing: !fs.existsSync(path.join(home(), CONFIG_FILE)), ...(lastReadEmpty ? { empty: true } : {}), settings: {} };
  const wholeDevice = parseWholeDevice(Object.values(readServiceConfigs()));
  return { readable: true, settings: { ...parseConfig(live), ...(wholeDevice !== undefined ? { wholeDevice } : {}) } };
}

export async function applyDaemonSettings(next: DaemonSettings): Promise<{ ok: boolean; error?: string }> {
  // Q0544: an empty config first; validating against it gave unrelated errors ('Basis must be per_gb or per_hour.').
  if (getDaemonSettings().empty) return { ok: false, error: EMPTY_SETTINGS_COPY };
  // Q0468/Q0478: the stored http RPC gate is carried through; a newly typed RPC stays https-only.
  validateForApply(next, getDaemonSettings().settings);
  // Q0338: dvpnd caps the prepay without a word; say it once here.
  const capped = prepayOverCap(next.prepayBytes, next.prepaySeconds);
  if (capped.length) log.warn('prepay above the service cap; dvpnd will use the cap', { capped, capBytes: String(PREPAY_CAP_BYTES), capSeconds: String(PREPAY_CAP_SECONDS) });
  const live = readLive();
  if (live === null) return { ok: false, error: tr('This app cannot read the VPN service settings on this account. Run the app once as administrator or re-run setup.') };
  const out = renderConfig(live, next);
  const staged = path.join(getHost().dataDir, 'staged');
  fs.mkdirSync(staged, { recursive: true });
  fs.writeFileSync(path.join(staged, CONFIG_FILE), out, 'utf8');
  fs.rmSync(path.join(staged, 'client.config.toml'), { force: true }); // pre-cb33 staging leftover
  // Whole-device mode: only the service configs that exist, only when the setting is given.
  for (const s of TUN_SERVICES) fs.rmSync(path.join(staged, `${s}.config.toml`), { force: true });
  if (next.wholeDevice !== undefined) {
    for (const [s, text] of Object.entries(readServiceConfigs())) {
      fs.writeFileSync(path.join(staged, `${s}.config.toml`), renderServiceConfig(text, next.wholeDevice), 'utf8');
    }
  }
  // 8070712: appUserAccount() is '' for a machine account (the app run as SYSTEM or a service); elevate refuses an
  // empty value, so User is left out then and the script skips the pipe grant (SYSTEM is admitted already).
  const user = appUserAccount();
  const r = await runElevated(scriptPath('apply-daemon-config.ps1'), { Staged: staged, DaemonHome: home(), Service: DAEMON_SERVICE, Bridge: binPath('pipe-bridge.exe'), ...(user ? { User: user } : {}) });
  log.info('daemon settings apply', { status: r.status, detail: r.detail });
  relinkDaemon();
  if (r.status === 'ok') return { ok: true };
  // fleet-bugs #3: the step can report an error (our time limit) after it applied. The script
  // restores its .bak whenever the service fails to start on the new files, so live == staged
  // with the service running means the change is in.
  if (r.status === 'error') {
    const after = readLive();
    // CODE-AUDIT E13: 'started' (it was stopped and is up now) is running too; only 'running' counted before, so an
    // apply that went in was reported failed when the service had to be started again.
    const svc = await startServiceIfStopped().catch((e: unknown) => { log.warn('service check after the apply failed', { err: (e as Error).message }); return 'failed'; });
    const running = svc === 'running' || svc === 'started';
    if (appliedAnyway(out, after, running)) {
      log.info('daemon settings applied although the admin step reported an error', { detail: r.detail });
      return { ok: true };
    }
  }
  return { ok: false, error: r.detail };
}

/**
 * The routes an exclude split leaves outside the VPN for this session, so a check (public IP) never asks
 * a service the split sends direct (the Linux app 2026-10-22: it answered with the user's own IP). Empty unless the
 * session runs an exclude split.
 */
export function splitExcludedRoutes(service: string | null | undefined): string[] {
  if (splitForSession(service) !== 'exclude') return [];
  const live = readLive();
  const v = live ? readToml(live, 'split', 'routes') : null;
  return Array.isArray(v) ? v.map(String) : [];
}
