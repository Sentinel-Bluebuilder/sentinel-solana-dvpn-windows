// ─── Daemon manager (D1, D5, F1, F4.5) ───
// The app is unelevated; dvpnd runs as a LocalSystem service. A standard user
// cannot open the daemon pipe with GENERIC_WRITE (UPSTREAM-GAPS #10), so we run
// resources/bin/pipe-bridge.exe as the user: it dials the daemon with the exact
// rights the pipe grants and re-serves it on a per-user pipe, printing
// "ready <path>". gRPC goes over that pipe. The bridge exits when our stdin closes.
import { levelFromSeverity, type CheckLevel } from '../../shared/check-level';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { DaemonClient, DaemonError, DEFAULT_WINDOWS_PIPE, pipeTarget, type DaemonVersion } from '../../core/daemon/client';
import { MINT, PROGRAM_ID } from '../../core/chain/idl';
import type { DaemonInfo } from '../../shared/types';
import { readJson, writeJson } from '../store';
import { runElevated, type ElevatedResult } from '../system/elevate';
import { log } from '../logger';
import { getHost } from '../host';
import {
  linkFault, OS_STATE_UNKNOWN, parseScQuery, scErrorCode, scStateNumber, retryDelayMs, serviceView, serviceViewFor,
  type LinkFault, type OsServiceState, type ServiceFacts, type ServiceView,
} from '../../core/daemon/service-state';
import { carrySettingsInto, patchToml, readToml, renderServiceConfig, TUN_SERVICES } from '../../core/daemon/config';
import { CONFIG_FILE, daemonBinaryName, doctorArgs, initArgs, instanceDir, keyListArgs, legacyHome, operatorKey, serviceName } from '../../core/daemon/layout';
import { tr } from '../../shared/i18n';

// cb33 layout (layout.ts): the client instance c0 in %ProgramData%\sentinel-dvpn\c0, service sentinel-dvpnd$c0.
export const DEFAULT_DAEMON_HOME = process.env.DVPN_DAEMON_HOME || instanceDir('win32', undefined, process.env.ProgramData || 'C:\\ProgramData');
export const DAEMON_SERVICE = serviceName('win32');
const DEVICE_FILE = 'device.json';
// rc9-c OWNER-PENDING (the macOS app b1750da48): an adopted service key whose service config may still name another wallet.
const OWNER_PENDING_FILE = 'service-owner-pending.json';

// ─── Paths ───
export function resourcesDir(): string {
  return getHost().resourcesDir;
}
export const binPath = (name: string): string => path.join(resourcesDir(), 'bin', name);
export const scriptPath = (name: string): string => path.join(resourcesDir(), 'scripts', name);
export const protoPath = (): string => path.join(resourcesDir(), 'daemon.proto');
/** rc9-c DVPND-BIN (macOS testing C3): an installed app. Its resources folder (<install>/resources/resources) sits beside
 *  Electron's app.asar; a dev tree's <repo>/resources does not. The CLI has no app.isPackaged, so the path decides. */
export function isPackagedResources(dir: string = resourcesDir(), exists: (p: string) => boolean = fs.existsSync): boolean {
  return exists(path.join(path.dirname(dir), 'app.asar'));
}

let dvpndBinIgnored = false;
/** The dvpnd binary. DVPND_BIN (a dev override) is honoured only outside an installed app: there a user-level
 *  variable would choose the binary setup-daemon.ps1 installs as the SYSTEM service (one UAC prompt). */
export function dvpndPath(env: NodeJS.ProcessEnv = process.env, packaged: boolean = isPackagedResources()): string {
  const own = binPath(daemonBinaryName('win32'));
  if (!env.DVPND_BIN) return own;
  if (packaged) {
    if (!dvpndBinIgnored) log.warn('DVPND_BIN is ignored in an installed app; its own dvpnd is used', { own });
    dvpndBinIgnored = true;
    return own;
  }
  return fs.existsSync(env.DVPND_BIN) ? env.DVPND_BIN : own;
}

// dvpnd finds V2Ray/Xray only on PATH (go-sdk service.LookPath). Each lives in its own
// folder because both ship different geoip/geosite files under the same names. The
// service gets these on its own PATH at install (setup-daemon.ps1); the doctor too.
export const PROTOCOL_BIN_DIRS = ['v2ray', 'xray', 'hysteria2'];
export const protocolBinDirs = (): string[] => PROTOCOL_BIN_DIRS.map((d) => binPath(d)).filter((d) => fs.existsSync(d));
const withProtocolPath = (): NodeJS.ProcessEnv => {
  const extra = protocolBinDirs();
  return extra.length ? { ...process.env, PATH: [process.env.PATH ?? '', ...extra].join(path.delimiter) } : process.env;
};

interface DeviceRecord { device: string; home: string; owner: string; at: number }

// ─── State ───
let bridge: ChildProcess | null = null;
let client: DaemonClient | null = null;
let restartTimer: NodeJS.Timeout | null = null;
/** Failed link attempts in a row; decides the wait before the next one (core/daemon/service-state retryDelayMs). */
let attempts = 0;
let stopping = false;
const info: DaemonInfo = { reachable: false, bridge: 'stopped', version: null, networkOk: null, error: null, home: null, device: null };
const listeners = new Set<() => void>();

export const onDaemonChange = (fn: () => void): (() => void) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (): void => { for (const l of listeners) l(); };

export function daemonInfo(): DaemonInfo {
  const d = deviceRecord();
  return { ...info, home: d?.home ?? null, device: d?.device ?? null, service: serviceNow() };
}

// ─── Service state (UI pass rows 119-142) ───
// The facts behind the one sentence: how the last link attempt failed, what the OS says about the service,
// and when it was last started. The sentence itself comes from core/daemon/service-state.ts.
let lastFault: LinkFault = 'unknown';
let osState: OsServiceState = { ...OS_STATE_UNKNOWN };
let startedAt: number | null = null;
let transitionProbe: () => boolean = () => false;
/** services/service-transition.ts tells the link whether a restart is in progress (it imports this module). */
export function setTransitionProbe(fn: () => boolean): void { transitionProbe = fn; }

export function serviceFacts(): ServiceFacts {
  let transition = false;
  try { transition = transitionProbe(); } catch (err) { log.warn('service state: the restart check failed', { err: (err as Error).message }); }
  return {
    answered: info.reachable, networkOk: info.networkOk, transition,
    installed: osState.installed, running: osState.running, startPending: osState.startPending,
    link: info.reachable ? 'none' : info.bridge === 'error' ? 'helper-missing' : lastFault,
    startedAgoMs: startedAt === null ? null : Date.now() - startedAt,
  };
}

/** The service's state now: one title, one sentence, one action. */
export function serviceNow(): ServiceView { return serviceViewFor(serviceFacts()); }

/** The service was just asked to start (this app, an install, a grant): link failures inside the grace read "starting". */
export function noteServiceStarting(): void { startedAt = Date.now(); }

const setError = (): void => { info.error = serviceNow().sentence || null; };

let osBusy = false;
/** Ask Windows about the service (sc query, no elevation). Other OSes have no such query here: unknown. */
async function refreshOsState(): Promise<void> {
  if (process.platform !== 'win32' || osBusy) return;
  osBusy = true;
  try {
    const out = await new Promise<string>((resolve) => {
      execFile('sc.exe', ['query', DAEMON_SERVICE], { timeout: 10_000, windowsHide: true }, (_err, stdout) => resolve(String(stdout)));
    });
    osState = parseScQuery(out);
  } finally {
    osBusy = false;
  }
}

/** Row 139: the same failure every second is one log line, then one a minute. */
// Kept per kind of failure (Windows VM 2026-11-15, build c975868: two kinds alternating every second, "pipe-bridge"
// and "pipe-bridge exited", each replaced the one remembered key, so 126 lines a minute while the service was not
// installed). A service that is not installed, off, starting or restarting is not a fault of the link: one info line.
const lastLogged = new Map<string, number>();
function logLinkFailure(what: string, raw: string): void {
  const state = serviceNow().state;
  const key = `${what}:${linkFault(raw)}:${state}`;
  const t = Date.now();
  if (t - (lastLogged.get(key) ?? 0) < 60_000) return;
  lastLogged.set(key, t);
  if (lastLogged.size > 64) for (const [k, at] of lastLogged) if (t - at > 60_000) lastLogged.delete(k);
  const expected = state === 'not-installed' || state === 'stopped' || state === 'starting' || state === 'restarting';
  log[expected ? 'info' : 'warn'](what, { err: raw.slice(0, 1500), state, attempts });
}

/** A link attempt failed: record how, say the state at once, then ask the OS and say it again if that changed it. */
function linkFailed(raw: string): void {
  lastFault = linkFault(raw);
  info.reachable = false;
  setError();
  void refreshOsState().then(() => {
    if (info.reachable) return;
    const before = info.error;
    setError();
    if (info.error !== before) emit();
    autoStart();
  }).catch((err) => log.warn('could not ask the OS about the VPN service', { err: (err as Error).message }));
}

// ─── The app starts a stopped service by itself (rows 120, 125) ───
// Once per stop: a service that will not stay up is not started in a loop (it refuses to start until the device
// has a spending permission), and the "off" sentence with its Start button shows instead.
let autoStarted = false;
/** An install or reinstall of the service is running (its admin step). The service exists but is not finished:
 *  Windows VM 2026-11-15, build c975868: the automatic start below ran 0.4 s after the installer created the
 *  service and before it had written the service's PATH (its v2ray / xray / hysteria2 folders), so the service
 *  ran without them and the first V2Ray connect failed after paying ("binary not found: v2ray"). */
let installing = 0;
export const serviceInstallRunning = (): boolean => installing > 0;
function autoStart(): void {
  if (autoStarted || stopping || installing > 0 || !watching || serviceNow().state !== 'stopped') return;
  autoStarted = true;
  log.info('the VPN service is installed but stopped; starting it');
  void startServiceIfStopped().then((r) => {
    log.info('automatic service start', { result: r });
    if (r === 'started' || r === 'running') { setError(); emit(); }
  }).catch((err) => log.warn('automatic service start failed', { err: (err as Error).message }));
}

// ─── Retry speed (row 121) ───
// Someone is looking at the app or waiting on a button: try the link every second. Otherwise back off.
let watching = false;
let watchers = 0;
/** The window is visible (true) or hidden/minimised to the tray (false). */
export function setLinkWatching(v: boolean): void {
  const was = watching || watchers > 0;
  watching = v;
  if (v && !was) retryNow();
}
/** Run `fn` with the fast retry on (Connect, Restore network, Diagnostics waiting for the service). */
export async function withLinkWatch<T>(fn: () => Promise<T>): Promise<T> {
  watchers += 1;
  if (watchers === 1 && !watching) retryNow();
  try { return await fn(); } finally { watchers -= 1; }
}
const nextDelay = (): number => retryDelayMs(attempts, watching || watchers > 0);

/** Tests only. */
export function resetLinkState(): void {
  attempts = 0; lastFault = 'unknown'; osState = { ...OS_STATE_UNKNOWN }; startedAt = null;
  autoStarted = false; watching = false; watchers = 0; lastLogged.clear();
  transitionProbe = () => false;
}

/** A button was pressed that needs the service: any waiting retry runs now. */
export function retryNow(): void {
  if (stopping || info.reachable) return;
  if (reattachTimer && reattachTarget) {
    clearTimeout(reattachTimer); reattachTimer = null;
    void attach(reattachTarget);
  } else if (restartTimer) {
    clearTimeout(restartTimer); restartTimer = null;
    startDaemonLink();
  }
}

export function deviceRecord(): DeviceRecord | null {
  const rec = readJson<DeviceRecord | null>(DEVICE_FILE, null);
  // A record from a pre-cb33 build names the old home; once `daemon migrate` moved it, use the new one.
  if (rec && rec.home.toLowerCase() === legacyHome('win32').toLowerCase() && fs.existsSync(path.join(DEFAULT_DAEMON_HOME, CONFIG_FILE))) {
    return { ...rec, home: DEFAULT_DAEMON_HOME };
  }
  return rec;
}

/** The connected gRPC client, or a clear error the UI can show. */
export function daemon(): DaemonClient {
  if (!client || !info.reachable) {
    const said = serviceNow().sentence || serviceView('stopped').sentence;
    throw new DaemonError(Object.assign(new Error(said), { code: 14, details: said }) as Error, 'daemon');
  }
  return client;
}

// ─── Bridge lifecycle ───
/** DVPN_DAEMON_PIPE overrides the daemon's control pipe (a foreground test daemon). */
export const daemonPipe = (): string => process.env.DVPN_DAEMON_PIPE || DEFAULT_WINDOWS_PIPE;

/** Resolves once the first attach attempt finished (success or not). */
let firstAttach: Promise<void> = Promise.resolve();
let resolveFirst: (() => void) | null = null;
export const daemonReady = (timeoutMs = 10_000): Promise<void> => Promise.race([firstAttach, new Promise<void>((r) => setTimeout(r, timeoutMs))]);

export function startDaemonLink(): void {
  stopping = false;
  firstAttach = new Promise((r) => { resolveFirst = r; });
  // DVPN_DAEMON_TARGET=host:port — a TCP-bridged daemon (the WSL test rig). Test/dev only.
  if (process.env.DVPN_DAEMON_TARGET) {
    info.bridge = 'missing';
    void attach(process.env.DVPN_DAEMON_TARGET);
    return;
  }
  const exe = binPath('pipe-bridge.exe');
  if (process.env.DVPN_NO_BRIDGE === '1' || !fs.existsSync(exe)) {
    info.bridge = 'missing';
    log.warn('no pipe bridge; dialling the daemon pipe directly (works only elevated)');
    void attach(pipeTarget(daemonPipe()));
    return;
  }
  const child = spawn(exe, ['-daemon', daemonPipe()], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  bridge = child;
  info.bridge = 'running';
  const rl = readline.createInterface({ input: child.stdout! });
  rl.on('line', (line) => {
    const m = /^ready (.+)$/.exec(line.trim());
    if (m) void attach(pipeTarget(m[1]));
  });
  // stderr arrives in small chunks (a Go panic is written word by word): gather it for a moment
  // so one message is one log line.
  let errBuf = '';
  let errTimer: NodeJS.Timeout | null = null;
  const flushErr = (): void => {
    errTimer = null;
    const t = errBuf.trim();
    errBuf = '';
    if (!t) return;
    linkFailed(t);
    logLinkFailure('pipe-bridge', t);
  };
  child.stderr!.on('data', (d: Buffer) => {
    errBuf += d.toString();
    if (!errTimer) errTimer = setTimeout(flushErr, 150);
  });
  child.on('exit', (code) => {
    if (errTimer) clearTimeout(errTimer);
    flushErr();
    // UI-166: the app closing its own link at quit is not a warning (and not a service restart).
    if (stopping) log.info('pipe-bridge closed with the app', { code });
    else logLinkFailure('pipe-bridge exited', `exit code ${code}`);
    if (resolveFirst) { resolveFirst(); resolveFirst = null; }
    // A newer bridge may already be running (relinkDaemon): only the current one's exit takes the link down.
    if (bridge !== child) return;
    bridge = null;
    detach();
    info.bridge = 'stopped';
    if (!stopping) setError();
    emit();
    if (!stopping) scheduleRestart();
  });
  child.on('error', (err) => {
    info.bridge = 'error';
    setError();
    log.error('pipe-bridge spawn failed', err);
    emit();
  });
}

/** True from the moment the app closes its own link (quit): a link going down then is not a service restart. */
export function linkStopping(): boolean { return stopping; }

function scheduleRestart(): void {
  if (restartTimer) return;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startDaemonLink();
  }, nextDelay());
  restartTimer.unref?.();
  attempts += 1;
}

let attachedTarget: string | null = null;
async function attach(target: string): Promise<void> {
  detach();
  attachedTarget = target;
  client = new DaemonClient(target, protoPath());
  try {
    const v = await client.getVersion();
    info.reachable = true;
    info.version = v.tag || v.commit || 'unknown';
    info.networkOk = networkMatches(v);
    lastFault = 'none';
    osState = { installed: true, running: true, startPending: false };
    setError();
    attempts = 0;
    autoStarted = false;
    lastLogged.clear();
    log.info('daemon attached', { version: info.version, network: v.network, networkOk: info.networkOk });
    startHeartbeat(target);
  } catch (err) {
    linkFailed((err as Error).message);
    logLinkFailure('daemon attach failed', (err as Error).message);
    // The bridge is still up but the service did not answer (busy starting, slow machine). Without
    // a retry the app stayed on "Install service" for an installed service until restarted
    // (VM ui-win-1 2026-10-22, e2-medium: "The VPN service did not answer in time").
    scheduleReattach(target);
  }
  emit();
  if (resolveFirst) { resolveFirst(); resolveFirst = null; }
}

// ─── Heartbeat ───
// The pipe-bridge outlives the service: a stopped or crashed dvpnd left `reachable` true until the
// next call failed, so the app never said "not answering" (VM ui-win-1 2026-10-22, service stopped
// mid-session). One local GetVersion every 10 s; two misses in a row = gone, then the normal
// reattach backoff takes over (one slow answer while the service is busy is not "gone").
export const HEARTBEAT_MS = 10_000;
let heartbeatTimer: NodeJS.Timeout | null = null;
let heartbeatMisses = 0;
function startHeartbeat(target: string): void {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    const c = client;
    if (!c || !info.reachable || stopping) return;
    c.getVersion().then(
      () => { heartbeatMisses = 0; },
      (err) => {
        if (client !== c || !info.reachable) return;
        heartbeatMisses += 1;
        if (heartbeatMisses < 2) return;
        log.warn('daemon heartbeat lost', { err: (err as Error).message });
        heartbeatMisses = 0;
        stopHeartbeat();
        linkFailed((err as Error).message);
        emit();
        scheduleReattach(target);
      },
    );
  }, HEARTBEAT_MS);
  heartbeatTimer.unref(); // never keeps a CLI process alive
}
function stopHeartbeat(): void {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  heartbeatMisses = 0;
}

let reattachTimer: NodeJS.Timeout | null = null;
let reattachTarget: string | null = null;
function scheduleReattach(target: string): void {
  if (reattachTimer || stopping) return;
  reattachTarget = target;
  const wait = nextDelay();
  attempts += 1;
  reattachTimer = setTimeout(() => {
    reattachTimer = null;
    if (!stopping && !info.reachable) void attach(target);
  }, wait);
  reattachTimer.unref?.();
}

/** Agent M Mac T3 r6: during a service restart the backoff (2 s, 4 s, ...) left the app unattached ~4 s after
 *  the service was ready, and the restarting banner stayed that much longer. The transition guard calls this
 *  each second while the link is down: a WAITING retry runs now (one already in flight is left alone). */
let verifying = false;
export function reattachSoon(): void {
  if (stopping) return;
  // DVPN-WIN tr-kill-down r51: a transition that began on an event (the session stream dropped) while the link
  // still read up waited for two missed 10 s heartbeats (~14 s) before the link read down, so the 20 s cap ran
  // to ~34 s after the crash. While a transition runs, a link that reads up is asked again now.
  if (info.reachable) {
    const c = client;
    if (!c || verifying) return;
    verifying = true;
    c.getVersion().then(
      () => { verifying = false; },
      (err: Error) => {
        verifying = false;
        if (client !== c || !info.reachable || stopping) return;
        log.warn('daemon did not answer during a service transition', { err: err.message });
        stopHeartbeat();
        linkFailed(err.message);
        emit();
        if (attachedTarget) scheduleReattach(attachedTarget);
      },
    );
    return;
  }
  retryNow();
}

/** Agent M (Mac): which service files run an older copy than this app ships. Windows: the installer re-runs
 *  setup-daemon on every upgrade (dvpnd, scripts and the restart policy, 8deb2d4), so nothing is left behind. */
export function serviceStaleNames(): string[] {
  return [];
}

export function networkMatches(v: Pick<DaemonVersion, 'programId' | 'mint'>): boolean {
  return v.programId === PROGRAM_ID.toBase58() && v.mint === MINT.toBase58();
}

function detach(): void {
  if (reattachTimer) { clearTimeout(reattachTimer); reattachTimer = null; }
  stopHeartbeat();
  if (client) {
    client.close();
    client = null;
  }
  info.reachable = false;
}

export function stopDaemonLink(): void {
  stopping = true;
  if (restartTimer) clearTimeout(restartTimer);
  detach();
  if (bridge) {
    bridge.stdin?.end(); // bridge exits on stdin EOF
    const b = bridge;
    setTimeout(() => { if (b.exitCode === null) b.kill(); }, 1500);
  }
}

/** Re-probe now (after setup or a settings restart). */
export function relinkDaemon(): void {
  attempts = 0;
  if (bridge) bridge.stdin?.end();
  else {
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
    startDaemonLink();
  }
}

// ─── Doctor (F1.6) ───
// dvpnd reports advisories as OK=true with a Detail (e.g. a protocol binary missing): that is a warning.
export interface DoctorCheck { name: string; ok: boolean; level: CheckLevel; detail: string }
/** dvpnd's real advisories (OK=true + Detail): a protocol program or adapter missing, plan delegate. */
const ADVISORY = /^(service_|delegate$)/;

/** dvpnd dfe36c7 printed {Name, OK, Detail}; cf4c372 prints {name, ok, detail}. Accept both. */
export function parseDoctorRows(json: string): DoctorCheck[] {
  const rows = JSON.parse(json) as Array<Record<string, unknown>>;
  return rows.map((r) => {
    const ok = (r.ok ?? r.OK) === true;
    const name = String(r.name ?? r.Name ?? '?');
    let detail = String(r.detail ?? r.Detail ?? '');
    // dvpnd prints a raw `dvpnctl grant open-grant …` command here; say it in the app's words (idea from the Linux app).
    if (name === 'grant' && !ok) detail = tr('This computer has no spending limit yet. Set one: Wallet → Set spending limit, or {command}.', { command: 'devnet-dvpn device setup --yes' });
    // The kill-switch row is OK with a status note; "nothing held" is the normal state, not a warning
    // (owner's laptop 2026-10-22 showed it as "!").
    if (name === 'kill_switch' && ok && /no persisted kill switch/i.test(detail)) detail = tr('Nothing held: internet is not blocked.');
    // cb33 rows carry a severity (ok = severity != "error"): it decides. Its normal kill-switch note
    // ("belongs to the running daemon's session; checks run unpinned") is severity ok, and a real
    // leftover says "left over" (two words), so text matching got both wrong. FLX, Linux port.
    const sev = typeof r.severity === 'string' ? r.severity.toLowerCase() : null;
    // Q0547: 'skip' = needs the service's rights, checked by the service at its start (grey, never ✓ or ✗).
    if (sev) return { name, ok, level: levelFromSeverity(sev, ok), detail };
    // Pre-cb33 daemons: no severity.
    if (name === 'kill_switch' && ok) return { name, ok, level: /unpinned|unusable|leftover/i.test(detail) ? 'warn' : 'ok', detail };
    return { name, ok, level: !ok ? 'fail' : detail && ADVISORY.test(name) ? 'warn' : 'ok', detail };
  });
}

export function runDoctor(home = deviceRecord()?.home ?? DEFAULT_DAEMON_HOME): Promise<DoctorCheck[]> {
  return new Promise((resolve) => {
    const exe = dvpndPath();
    if (!fs.existsSync(exe)) { resolve([{ name: 'binary', ok: false, level: 'fail', detail: tr('The VPN service program is not installed with this app.') }]); return; }
    execFile(exe, doctorArgs(home), { timeout: 60_000, windowsHide: true, env: withProtocolPath() }, (err, stdout, stderr) => {
      const text = String(stdout);
      const start = text.indexOf('[');
      if (start >= 0) {
        try {
          resolve(parseDoctorRows(text.slice(start)));
          return;
        } catch (parseErr) {
          log.warn('doctor output not JSON', { err: (parseErr as Error).message });
        }
      }
      resolve([{ name: 'doctor', ok: false, level: 'fail', detail: (err?.message ?? String(stderr)).slice(0, 300) }]);
    });
  });
}

// ─── First-run setup (F1.5) ───
// dvpnd will not start until its device key holds a grant, so setup is:
//   1. initDevice   — `dvpnd init` UNELEVATED into <data>/daemon-staging → device address
//   2. (owner signs device setup: delegate + grant + SOL — services/wallet.deviceSetup)
//   3. installService — ONE UAC prompt: copy into ProgramData, lock keys, install + start
export function stagingHome(): string {
  return path.join(getHost().dataDir, 'daemon-staging');
}

// ─── Wallet switch (rc.4 E-55) ───
// A switch to another wallet used to write device.json and the staging home FIRST, so any refusal after it
// (too little SOL, setup or install failing) left this computer recorded for the new wallet: the first
// wallet's deposits went unlisted and the next switch back stopped on "a half-finished setup". Now the new
// key is made in its own scratch folder, device.json and the staging home are never touched before the
// setup has landed AND the service runs the new key, and a failure leaves them byte-identical.
export function switchHome(): string {
  return path.join(getHost().dataDir, 'daemon-switch');
}
const SWITCH_FILE = 'switch.json';
interface SwitchRecord { device: string; owner: string; at: number }

/** The switch waiting in the scratch folder (its key may already hold a grant and fee SOL), or null. */
export function pendingSwitch(): SwitchRecord | null {
  try {
    const p = path.join(switchHome(), SWITCH_FILE);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) as SwitchRecord : null;
  } catch (err) {
    log.warn('unreadable wallet-switch record', { err: (err as Error).message });
    return null;
  }
}

/** A device key for `owner` in the scratch folder (reused when one is already there for it). Writes nothing else. */
export function stageSwitchDevice(owner: string): Promise<{ ok: boolean; device?: string; error?: string }> {
  const have = pendingSwitch();
  if (have && have.owner === owner) return Promise.resolve({ ok: true, device: have.device });
  if (have) return Promise.resolve({ ok: false, error: tr('A switch to another wallet ({wallet}) was started and not finished. Load that wallet to finish it, or remove the half-finished setup (Diagnostics, or: {command}). Nothing was paid.', { wallet: `${have.owner.slice(0, 4)}…${have.owner.slice(-4)}`, command: 'devnet-dvpn device discard-setup --yes' }) });
  const exe = dvpndPath();
  if (!fs.existsSync(exe)) return Promise.resolve({ ok: false, error: tr('The VPN service is missing from this install. Reinstall the app.') });
  const scratch = switchHome();
  if (fs.existsSync(scratch)) fs.rmSync(scratch, { recursive: true, force: true }); // a folder with no record holds no key anyone uses
  return new Promise((resolve) => {
    execFile(exe, initArgs(scratch, owner), { timeout: 60_000, windowsHide: true }, (err, stdout, stderr) => {
      const text = String(stdout);
      const at = text.indexOf('{');
      if (err || at < 0) {
        fs.rmSync(scratch, { recursive: true, force: true });
        resolve({ ok: false, error: tr('Could not set up the VPN service for this wallet. Try again, or send the log from Diagnostics ({slice}).', { slice: (err?.message ?? String(stderr)).slice(0, 300) }) });
        return;
      }
      try {
        const init = JSON.parse(text.slice(at)) as { public_key: string };
        carryLiveSettings(scratch);
        wholeDeviceByDefault(scratch);
        fs.writeFileSync(path.join(scratch, SWITCH_FILE), JSON.stringify({ device: init.public_key, owner, at: Date.now() } satisfies SwitchRecord));
        log.info('wallet switch staged', { device: init.public_key });
        resolve({ ok: true, device: init.public_key });
      } catch (parseErr) {
        fs.rmSync(scratch, { recursive: true, force: true });
        resolve({ ok: false, error: tr('Could not set up the VPN service for this wallet. Try again, or send the log from Diagnostics (unreadable output: {message}).', { message: (parseErr as Error).message }) });
      }
    });
  });
}

/**
 * A setup left half done that Diagnostics offers to remove (UI-SCREENS): a wallet switch waiting in the scratch
 * folder, or a staged install whose device record names another wallet than the loaded one (the rc.3 E-55 state).
 * A staged install for the loaded wallet is the normal "finish on the next Connect" and is not counted.
 */
export function halfFinishedSetup(loaded: string | null): boolean {
  if (pendingSwitch()) return true;
  if (!installPending()) return false;
  const rec = deviceRecord();
  return !rec || !loaded || rec.owner !== loaded;
}

/** The snapshot's view of the device record for the loaded wallet (AppSnapshot.deviceOwner / halfFinishedSetup). */
export function deviceStateFor(loaded: string | null): { deviceOwner: string | null; halfFinishedSetup: boolean } {
  try {
    return { deviceOwner: deviceRecord()?.owner ?? null, halfFinishedSetup: halfFinishedSetup(loaded) };
  } catch (err) {
    log.warn('device state unreadable', { err: (err as Error).message });
    return { deviceOwner: null, halfFinishedSetup: false };
  }
}

/** After the service runs the switched key: record it and drop the scratch folder. */
export function commitSwitch(s: SwitchRecord): void {
  writeJson(DEVICE_FILE, { device: s.device, home: DEFAULT_DAEMON_HOME, owner: s.owner, at: Date.now() } satisfies DeviceRecord);
  fs.rmSync(switchHome(), { recursive: true, force: true });
  log.info('wallet switch done', { device: s.device, owner: s.owner });
}

/**
 * The real "remove the half-finished setup" (rc.4: the error named a Settings control that did not exist).
 * Removes the staging home and the switch scratch folder; device.json and the installed service are kept.
 * A switch key that already holds a grant is named in the log so its refund can be found.
 */
export function discardHalfFinishedSetup(): { removed: string[] } {
  const removed: string[] = [];
  const sw = pendingSwitch();
  if (sw) log.warn('discarding a half-finished wallet switch', { device: sw.device, owner: sw.owner });
  for (const dir of [stagingHome(), switchHome()]) {
    if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); removed.push(dir); }
  }
  return { removed };
}

/**
 * fleet-bugs W3: a wallet switch installs this fresh home in place of the old one (setup-daemon.ps1
 * W1), so copy the user's settings (kill switch, DNS, LAN, split, RPC, payment limits, whole-device)
 * from the installed home into it first. Nothing installed yet, or unreadable: dvpnd defaults stay.
 */
export function carryLiveSettings(staging: string, live = DEFAULT_DAEMON_HOME): void {
  // The installed home is the cb33 one (one config.toml) or, before the upgrade ran, a pre-cb33 pair.
  const liveCfg = path.join(live, CONFIG_FILE);
  const legacyClient = path.join(live, 'client', CONFIG_FILE);
  if (!fs.existsSync(liveCfg)) return;
  const legacy = fs.existsSync(legacyClient);
  try {
    const target = path.join(staging, CONFIG_FILE);
    const root = fs.readFileSync(liveCfg, 'utf8');
    const old = { root, client: legacy ? fs.readFileSync(legacyClient, 'utf8') : root };
    fs.writeFileSync(target, carrySettingsInto(old, fs.readFileSync(target, 'utf8')), 'utf8');
    for (const s of TUN_SERVICES) {
      // cb33 keeps per-service files at <instance>\<service>\config.toml (pre-cb33: <home>\client\<service>\).
      const from = path.join(live, ...(legacy ? ['client', s] : [s]), CONFIG_FILE);
      const into = path.join(staging, s, CONFIG_FILE);
      if (!fs.existsSync(from) || !fs.existsSync(into)) continue;
      const tun = readToml(fs.readFileSync(from, 'utf8'), '', 'tun');
      if (typeof tun === 'boolean') fs.writeFileSync(into, renderServiceConfig(fs.readFileSync(into, 'utf8'), tun), 'utf8');
    }
    log.info('settings carried to the new device home', { from: live });
  } catch (err) {
    log.warn('could not carry settings to the new device home; dvpnd defaults stay', { error: (err as Error).message });
  }
}

/**
 * Owner 2026-11-12: V2Ray and Xray use the whole computer by default. dvpnd init writes tun = false;
 * a fresh install (no service file for that protocol in the live home) gets tun = true. A choice the
 * user already made is carried by carryLiveSettings and kept.
 */
export function wholeDeviceByDefault(staging: string, live = DEFAULT_DAEMON_HOME): void {
  for (const s of TUN_SERVICES) {
    const into = path.join(staging, s, CONFIG_FILE);
    if (!fs.existsSync(into) || fs.existsSync(path.join(live, s, CONFIG_FILE)) || fs.existsSync(path.join(live, 'client', s, CONFIG_FILE))) continue;
    try {
      fs.writeFileSync(into, renderServiceConfig(fs.readFileSync(into, 'utf8'), true), 'utf8');
    } catch (err) {
      log.warn('could not turn on whole computer for a new install', { service: s, error: (err as Error).message });
    }
  }
}

/**
 * Q0507 (release blocker): dvpnd init writes kill_switch = 'on', and the 11-07 migration
 * (migrate-daemon-config.ps1, meant for a USER's "On") turned it into 'persist' before the first start,
 * so every fresh install ran "Always": install, connect, reboot = no internet while the app said "Not
 * connected". F14.1 / NETWORK-SAFETY row 2: the kill switch is the user's choice. A fresh install (no
 * installed home to carry from) stages 'off'; the user turns it on from the Kill switch page. An
 * existing home (update, reinstall over a kept home, wallet switch) keeps the user's value through
 * carryLiveSettings, and a carried 'on' still becomes persist there.
 */
export function killSwitchOffOnFreshInstall(staging: string, live = DEFAULT_DAEMON_HOME): void {
  if (fs.existsSync(path.join(live, CONFIG_FILE)) || fs.existsSync(path.join(live, 'client', CONFIG_FILE))) return;
  const target = path.join(staging, CONFIG_FILE);
  try {
    fs.writeFileSync(target, patchToml(fs.readFileSync(target, 'utf8'), 'network', 'kill_switch', 'off'), 'utf8');
  } catch (err) {
    log.warn('could not stage the kill switch off for a new install', { error: (err as Error).message });
  }
}

/** E-ST (the agent tools rc.9): what initDevice needs to adopt an installed service's key (injected in tests). */
export interface AdoptDeps { record: () => DeviceRecord | null; home: string; has: (file: string) => boolean; detect: (home: string) => Promise<{ ok: boolean; device?: string; error?: string }>; register: (device: string, owner: string, home: string) => void; markOwnerPending?: (owner: string) => void }

/** A computer with no device record whose service is installed uses the service's own key (recorded for `owner`).
 *  null = nothing to adopt (a record exists, no service home, or its key could not be read): mint as before. */
export async function adoptInstalledDevice(owner: string, deps: AdoptDeps = { record: deviceRecord, home: DEFAULT_DAEMON_HOME, has: (f) => fs.existsSync(f), detect: detectDevice, register: registerDevice, markOwnerPending: (o) => writeJson(OWNER_PENDING_FILE, { owner: o, at: Date.now() }) }): Promise<string | null> {
  if (deps.record() || !deps.has(path.join(deps.home, CONFIG_FILE))) return null;
  const d = await deps.detect(deps.home);
  if (!d.ok || !d.device) { log.warn('device: the installed service key could not be read; a new key is made', { err: d.error }); return null; }
  deps.register(d.device, owner, deps.home);
  deps.markOwnerPending?.(owner); // the install step points the service at this wallet (installPending)
  log.info('device: adopted the installed service key', { device: d.device, home: deps.home });
  return d.device;
}

export async function initDevice(owner: string): Promise<{ ok: boolean; device?: string; error?: string }> {
  const existing = deviceRecord();
  if (existing && existing.owner === owner) return { ok: true, device: existing.device };
  // E-ST: never mint a staging key beside an installed service (wallet show then named the wrong device).
  if (!existing) {
    const adopted = await adoptInstalledDevice(owner);
    if (adopted) return { ok: true, device: adopted };
  }
  const exe = dvpndPath();
  if (!fs.existsSync(exe)) return Promise.resolve({ ok: false, error: tr('The VPN service is missing from this install. Reinstall the app.') });
  const staging = stagingHome();
  if (fs.existsSync(path.join(staging, CONFIG_FILE))) {
    return Promise.resolve({ ok: false, error: tr('A half-finished setup exists. Remove it in Diagnostics (or: {command}), then try again. Nothing was paid.', { command: 'devnet-dvpn device discard-setup --yes' }) });
  }
  return new Promise((resolve) => {
    // cb33: `init --instance c0 --home <staging>`; no --role (the tag says client) and no socket group (the
    // service grants its pipe to the sentinel-dvpn group; setup-daemon.ps1 adds the user to it).
    execFile(exe, initArgs(staging, owner), { timeout: 60_000, windowsHide: true }, (err, stdout, stderr) => {
      const text = String(stdout);
      const at = text.indexOf('{');
      if (err || at < 0) { resolve({ ok: false, error: tr('Could not set up the VPN service. Try again, or send the log from Diagnostics ({slice}).', { slice: (err?.message ?? String(stderr)).slice(0, 300) }) }); return; }
      try {
        const init = JSON.parse(text.slice(at)) as { public_key: string };
        writeJson(DEVICE_FILE, { device: init.public_key, home: DEFAULT_DAEMON_HOME, owner, at: Date.now() } satisfies DeviceRecord);
        log.info('device initialised', { device: init.public_key });
        carryLiveSettings(staging);
        wholeDeviceByDefault(staging);
        killSwitchOffOnFreshInstall(staging);
        resolve({ ok: true, device: init.public_key });
      } catch (parseErr) {
        resolve({ ok: false, error: tr('Could not set up the VPN service. Try again, or send the log from Diagnostics (unreadable output: {message}).', { message: (parseErr as Error).message }) });
      }
    });
  });
}

/** L6: poll (bounded) until `probe` is true; probes and sleep are injectable (exported for tests). */
export async function pollUntil(
  probe: () => Promise<boolean>,
  waitMs = 30_000,
  stepMs = 2_000,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<boolean> {
  for (let waited = 0; ; waited += stepMs) {
    if (await probe()) return true;
    if (waited + stepMs > waitMs) return false;
    await sleep(stepMs);
  }
}

/** `sc query` text -> is the service RUNNING (state 4). Exported for tests (the pattern once lost its backslashes: live proof L6 strict). */
export function scQueryRunning(stdout: string): boolean {
  return scStateNumber(stdout) === 4; // L-30: by number, not the word STATE (German Windows: STATUS)
}

function serviceRunning(service: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('sc.exe', ['query', service], { timeout: 10_000, windowsHide: true }, (_err, stdout) => resolve(scQueryRunning(String(stdout))));
  });
}

/** After the install step ran past its time limit (and its grace): did the service come up anyway? */
async function verifyInstalled(): Promise<ElevatedResult> {
  if (await pollUntil(() => serviceRunning(DAEMON_SERVICE))) {
    log.info('install step timed out but the service is running', { service: DAEMON_SERVICE });
    return { status: 'ok', detail: tr('service installed and running (the administrator step took longer than expected)') };
  }
  return { status: 'error', detail: tr('The administrator step took too long and the VPN service is off. Try again; if it keeps happening, send the log from Diagnostics.') };
}

/**
 * The Windows account running the app, for setup-daemon.ps1's pipe group (sentinel-dvpn). Passed
 * explicitly: under an over-the-shoulder UAC prompt the elevated script runs as another account.
 */
export function appUserAccount(env: NodeJS.ProcessEnv = process.env): string {
  const user = env.USERNAME ?? '';
  // The machine account (SYSTEM or a service: HOST$) is no app user, and dq() refuses its `$`.
  if (user.endsWith('$')) { log.info('machine account; leaving it to setup-daemon.ps1'); return ''; }
  // Windows OpenSSH on a workgroup machine sets USERDOMAIN=WORKGROUP: not an account domain, so net.exe
  // said "no such global user or group: WORKGROUP\ddv" (rc2). A local account's domain is the computer.
  const domain = env.USERDOMAIN && !/^workgroup$/i.test(env.USERDOMAIN) ? env.USERDOMAIN : env.COMPUTERNAME;
  return domain && user ? `${domain}\\${user}` : user;
}

/** { User } for an elevated step, or nothing when there is no app user (dq() refuses ''). */
function userArg(): { User?: string } {
  const u = appUserAccount();
  return u ? { User: u } : {};
}

/**
 * The service is installed but refuses this app (the user joined its group after signing in).
 * One admin step gives this account the pipe directly (grant-pipe.ps1); no sign-out. Owner 2026-11-12.
 */
export async function grantPipeAccess(): Promise<{ ok: boolean; error?: string }> {
  const user = userArg();
  // The machine account is admitted by the pipe already (SYSTEM); grant-pipe.ps1 needs a user (Mandatory).
  if (!user.User) { relinkDaemon(); return { ok: true }; }
  const r = await runElevated(scriptPath('grant-pipe.ps1'), { Bridge: binPath('pipe-bridge.exe'), ...user, Service: DAEMON_SERVICE, Persist: '1' });
  log.info('pipe access grant', { status: r.status, detail: r.detail });
  if (r.status === 'ok') noteServiceStarting();
  relinkDaemon();
  return r.status === 'ok' ? { ok: true } : { ok: false, error: r.detail };
}

/** setup-daemon.ps1 says "relogin-needed" when it just added the user to the pipe group (Windows applies it at sign-in). */
export const needsRelogin = (detail: string | undefined): boolean => /relogin-needed/.test(detail ?? '');

/** Elevated: move the staged home into ProgramData and run it as the sentinel-dvpnd$c0 service. Call after device setup. */
/** A device key made for a new wallet waits in the staging home until the service is (re)installed. */
export function installPending(): boolean {
  return fs.existsSync(path.join(stagingHome(), CONFIG_FILE)) || ownerPending() !== null;
}

/** rc9-c OWNER-PENDING: the wallet an adopted service key still has to be pointed at by the install step, or null. */
export function ownerPending(): string | null {
  return readJson<{ owner?: string } | null>(OWNER_PENDING_FILE, null)?.owner ?? null;
}

/** In-app removal (shared IPC SERVICE_UNINSTALL / daemon uninstall, the macOS app). Windows removes the service with the app. */
export async function uninstallService(): Promise<{ ok: boolean; error?: string; code?: string }> {
  return { ok: false, error: tr('On Windows, remove Devnet dVPN from Settings > Apps: that removes the VPN service too.'), code: 'unsupported' };
}

/** rc9-c OWNER-SYNC: setup-daemon.ps1's arguments. Owner = the wallet this device record is for, so a service home
 *  kept for the same key is pointed at that wallet (E-ST + a wallet switch left owner = the old one). Exported for tests. */
export function setupDaemonArgs(rec: DeviceRecord, staging: string): Record<string, string> {
  return { Dvpnd: dvpndPath(), Staging: staging, DaemonHome: rec.home, Service: DAEMON_SERVICE, BinRoot: path.dirname(binPath('x')), Owner: rec.owner, ...userArg() };
}

/** rc9-c OWNER-SYNC: the wallet the installed service runs for (config.toml `owner`; users may read it), or null. */
export function serviceOwner(home = DEFAULT_DAEMON_HOME): string | null {
  try {
    const owner = readToml(fs.readFileSync(path.join(home, CONFIG_FILE), 'utf8'), '', 'owner');
    return typeof owner === 'string' && owner ? owner : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('service owner unreadable', { err: (err as Error).message });
    return null;
  }
}

export async function installService(staging = stagingHome()): Promise<{ ok: boolean; error?: string; code?: string; data?: { relogin: boolean } }> {
  const rec = deviceRecord();
  if (!rec) return { ok: false, error: tr('Initialise the device first.') };
  installing += 1; // nothing else starts the service while its installer runs (see autoStart)
  let r: Awaited<ReturnType<typeof runElevated>>;
  try {
    r = await runElevated(scriptPath('setup-daemon.ps1'), setupDaemonArgs(rec, staging), undefined, verifyInstalled);
  } finally {
    installing -= 1;
  }
  if (r.status === 'ok') noteServiceStarting();
  if (r.status === 'ok' && ownerPending()) writeJson(OWNER_PENDING_FILE, null);
  relinkDaemon();
  if (r.status !== 'ok') return { ok: false, error: r.detail, ...(r.code ? { code: r.code } : {}) }; // WIN-W4: needs-admin
  const relogin = needsRelogin(r.detail);
  if (relogin) log.info('service installed; Windows applies its access at the next sign-in', { user: appUserAccount() });
  return { ok: true, data: { relogin } };
}

/**
 * Start the installed service if it is stopped, without elevation (service-user-start.ps1 gives
 * interactive users the start right). dvpnd refuses to start until the device has a grant, so
 * after device setup on an upgraded or new install the service is usually stopped.
 * 'no-right' = an older install without that right: the caller says to use Diagnostics.
 */
export function startServiceIfStopped(service = DAEMON_SERVICE): Promise<'running' | 'started' | 'no-service' | 'no-right' | 'failed'> {
  // Off Windows there is no sc.exe query: we can't tell "not installed" from "stopped", so never
  // claim the service is missing (that copy says to reinstall). Ports query systemd/launchd here.
  if (process.platform !== 'win32') return Promise.resolve('failed');
  const sc = (args: string[]) => new Promise<{ code: number; out: string }>((resolve) => {
    execFile('sc.exe', args, { timeout: 20_000, windowsHide: true }, (err, stdout) => {
      resolve({ code: err ? Number((err as NodeJS.ErrnoException & { code?: unknown }).code) || 1 : 0, out: String(stdout) });
    });
  });
  return (async () => {
    const q = await sc(['query', service]);
    if (scErrorCode(q.out) === 1060) return 'no-service';
    if (scStateNumber(q.out) === 4) return 'running';
    const s = await sc(['start', service]);
    if (s.code === 0 || scErrorCode(s.out) === 1056) { noteServiceStarting(); relinkDaemon(); return 'started'; }  // 1056 = already running
    if (scErrorCode(s.out) === 5) return 'no-right';
    log.warn('service start failed', { out: s.out.slice(0, 300) });
    return 'failed';
  })();
}

// ─── The one button (UI pass rows 119-142) ───
/** Wait (with the fast retry on) until the service answers, at most maxMs. */
async function waitAnswer(maxMs: number): Promise<boolean> {
  return withLinkWatch(async () => {
    const until = Date.now() + maxMs;
    while (!info.reachable && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
    return info.reachable;
  });
}

export interface FixResult { ok: boolean; error?: string; code?: string; data?: { did: string; state: string } }

/**
 * Do the one action of the state the service is in now, then wait for it to answer. The screens' single
 * button calls this (IPC DAEMON_INIT step 'fix'), so the button never does something the sentence did not say.
 * install / reinstall / finish-setup ask for an administrator once; start and repair do not (repair asks only
 * when re-linking alone did not help and the service refuses this account).
 */
export async function fixService(): Promise<FixResult> {
  const v = serviceNow();
  const done = (did: string): FixResult => {
    const now = serviceNow();
    return now.state === 'ready' ? { ok: true, data: { did, state: now.state } } : { ok: false, error: now.sentence, code: now.code ?? 'daemon-unavailable', data: { did, state: now.state } };
  };
  log.info('service fix', { state: v.state, action: v.action });
  if (v.state === 'ready') return { ok: true, data: { did: 'none', state: v.state } };
  if (v.action === null) { // starting, restarting: nothing to press, wait for it
    retryNow();
    await waitAnswer(30_000);
    return done('wait');
  }
  if (v.action === 'start') {
    const r = await startServiceIfStopped();
    if (r === 'no-service') { osState = { installed: false, running: false, startPending: false }; setError(); emit(); return done('start'); }
    if (r === 'failed') return { ok: false, error: tr('The VPN service did not start. Open Diagnostics and run the check to see why.'), code: 'service-start-failed', data: { did: 'start', state: v.state } };
    if (r === 'no-right') {
      // An older install without the right to start it as a standard user: the setup step grants it.
      const i = await installService();
      if (!i.ok) return { ok: false, error: i.error, code: 'service-install-failed', data: { did: 'install', state: v.state } };
    }
    await waitAnswer(30_000);
    return done('start');
  }
  if (v.action === 'install' || v.action === 'reinstall') {
    const i = await installService();
    if (!i.ok) return { ok: false, error: i.error, code: 'service-install-failed', data: { did: v.action, state: v.state } };
    await waitAnswer(30_000);
    return done(v.action);
  }
  if (v.action === 'finish-setup') {
    const g = await grantPipeAccess();
    if (!g.ok) return { ok: false, error: g.error ?? v.sentence, code: 'daemon-relogin', data: { did: 'finish-setup', state: v.state } };
    await waitAnswer(30_000);
    return done('finish-setup');
  }
  // repair: a fresh link first (no administrator); only if the service then refuses this account, the grant.
  relinkDaemon();
  if (!await waitAnswer(10_000) && serviceNow().state === 'no-permission') {
    const g = await grantPipeAccess();
    if (!g.ok) return { ok: false, error: g.error ?? serviceNow().sentence, code: 'daemon-relogin', data: { did: 'repair', state: serviceNow().state } };
    await waitAnswer(30_000);
  }
  return done('repair');
}

/** Read the device public key of an existing home (`sentinel-dvpnd key list`: the operator key). Fails when its key folder is admin-only. */
export function detectDevice(home = DEFAULT_DAEMON_HOME): Promise<{ ok: boolean; device?: string; error?: string }> {
  const exe = dvpndPath();
  if (!fs.existsSync(exe)) return Promise.resolve({ ok: false, error: tr('The VPN service is missing from this install. Reinstall the app.') });
  return new Promise((resolve) => {
    execFile(exe, keyListArgs(home), { timeout: 20_000, windowsHide: true }, (err, stdout, stderr) => {
      const text = String(stdout);
      const at = text.indexOf('[');
      if (err || at < 0) { resolve({ ok: false, error: tr('Could not read the service\'s device key ({slice}). Enter its address instead.', { slice: (err?.message ?? String(stderr)).trim().slice(0, 160) }) }); return; }
      try {
        const keys = JSON.parse(text.slice(at)) as Array<{ name: string; public_key: string }>;
        const dev = operatorKey(keys);
        resolve(dev ? { ok: true, device: dev.public_key } : { ok: false, error: tr('The service home has no device key.') });
      } catch (parseErr) {
        resolve({ ok: false, error: tr('Could not read the service\'s device key (unreadable output: {message}). Enter its address instead.', { message: (parseErr as Error).message }) });
      }
    });
  });
}

/** Record an already-initialised daemon's device key (e.g. service set up by an admin). */
export function registerDevice(device: string, owner: string, home = DEFAULT_DAEMON_HOME): void {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(device)) throw new Error('The device must be a Solana address (base58).');
  writeJson(DEVICE_FILE, { device, home, owner, at: Date.now() } satisfies DeviceRecord);
}

/** Linux Q0431: the recorded service home is gone, so setup must say so. Windows keeps a fixed home: never. */
export function deviceHomeGone(): string | null {
  return null;
}

/**
 * Android: the app restarts its own VPN engine (Restore network when dvpnd does not answer). The desktop
 * runs dvpnd as a system service the user restarts, so this is never reached here (connection.ts calls
 * it only on isAndroid()); the platform export keeps that shared file identical on every OS.
 */
export async function restartAndroidDaemon(): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: tr('Only the Android app restarts its own VPN engine.') };
}
