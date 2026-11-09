// ─── Daemon manager (D1, D5, F1, F4.5) ───
// The app is unelevated; dvpnd runs as a LocalSystem service. A standard user
// cannot open the daemon pipe with GENERIC_WRITE (UPSTREAM-GAPS #10), so we run
// resources/bin/pipe-bridge.exe as the user: it dials the daemon with the exact
// rights the pipe grants and re-serves it on a per-user pipe, printing
// "ready <path>". gRPC goes over that pipe. The bridge exits when our stdin closes.
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
import { daemonLinkCopy } from '../../core/daemon/link-copy';
import { carrySettingsInto, readToml, renderServiceConfig, TUN_SERVICES } from '../../core/daemon/config';
import { CONFIG_FILE, daemonBinaryName, doctorArgs, initArgs, instanceDir, keyListArgs, legacyHome, operatorKey, serviceName } from '../../core/daemon/layout';

// cb33 layout (layout.ts): the client instance c0 in %ProgramData%\sentinel-dvpn\c0, service sentinel-dvpnd$c0.
export const DEFAULT_DAEMON_HOME = process.env.DVPN_DAEMON_HOME || instanceDir('win32', undefined, process.env.ProgramData || 'C:\\ProgramData');
export const DAEMON_SERVICE = serviceName('win32');
const DEVICE_FILE = 'device.json';

// ─── Paths ───
export function resourcesDir(): string {
  return getHost().resourcesDir;
}
export const binPath = (name: string): string => path.join(resourcesDir(), 'bin', name);
export const scriptPath = (name: string): string => path.join(resourcesDir(), 'scripts', name);
export const protoPath = (): string => path.join(resourcesDir(), 'daemon.proto');
export function dvpndPath(): string {
  return process.env.DVPND_BIN && fs.existsSync(process.env.DVPND_BIN) ? process.env.DVPND_BIN : binPath(daemonBinaryName('win32'));
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
let backoffMs = 2000;
let stopping = false;
const info: DaemonInfo = { reachable: false, bridge: 'stopped', version: null, networkOk: null, error: null, home: null, device: null };
const listeners = new Set<() => void>();

export const onDaemonChange = (fn: () => void): (() => void) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (): void => { for (const l of listeners) l(); };

export function daemonInfo(): DaemonInfo {
  const d = deviceRecord();
  return { ...info, home: d?.home ?? null, device: d?.device ?? null };
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
  if (!client || !info.reachable) throw new DaemonError(Object.assign(new Error(info.error ?? 'The VPN service is not running.'), { code: 14, details: info.error ?? 'The VPN service is not running.' }) as Error, 'daemon');
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
    info.error = daemonLinkCopy(t);
    log.warn('pipe-bridge', { stderr: t.slice(0, 1500) });
  };
  child.stderr!.on('data', (d: Buffer) => {
    errBuf += d.toString();
    if (!errTimer) errTimer = setTimeout(flushErr, 150);
  });
  child.on('exit', (code) => {
    if (errTimer) clearTimeout(errTimer);
    flushErr();
    log.warn('pipe-bridge exited', { code });
    if (resolveFirst) { resolveFirst(); resolveFirst = null; }
    bridge = null;
    detach();
    info.bridge = 'stopped';
    emit();
    if (!stopping) scheduleRestart();
  });
  child.on('error', (err) => {
    info.bridge = 'error';
    info.error = 'A part of this app is missing or blocked (pipe-bridge). Reinstall the app.';
    log.error('pipe-bridge spawn failed', err);
    emit();
  });
}

function scheduleRestart(): void {
  if (restartTimer) return;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startDaemonLink();
  }, backoffMs);
  backoffMs = Math.min(backoffMs * 2, 30_000);
}

async function attach(target: string): Promise<void> {
  detach();
  client = new DaemonClient(target, protoPath());
  try {
    const v = await client.getVersion();
    info.reachable = true;
    info.version = v.tag || v.commit || 'unknown';
    info.networkOk = networkMatches(v);
    info.error = info.networkOk ? null : `The VPN service is set up for a different network (${v.network}). This app is devnet only.`;
    backoffMs = 2000;
    log.info('daemon attached', { version: info.version, network: v.network, networkOk: info.networkOk });
    startHeartbeat(target);
  } catch (err) {
    info.reachable = false;
    info.error = daemonLinkCopy((err as Error).message);
    log.warn('daemon attach failed', { err: (err as Error).message, retryInMs: backoffMs });
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
        info.reachable = false;
        info.error = daemonLinkCopy((err as Error).message);
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
function scheduleReattach(target: string): void {
  if (reattachTimer || stopping) return;
  const wait = backoffMs;
  backoffMs = Math.min(backoffMs * 2, 30_000);
  reattachTimer = setTimeout(() => {
    reattachTimer = null;
    if (!stopping && !info.reachable) void attach(target);
  }, wait);
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
  backoffMs = 2000;
  if (bridge) bridge.stdin?.end();
  else startDaemonLink();
}

// ─── Doctor (F1.6) ───
// dvpnd reports advisories as OK=true with a Detail (e.g. a protocol binary missing): that is a warning.
export interface DoctorCheck { name: string; ok: boolean; level: 'ok' | 'warn' | 'fail'; detail: string }
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
    if (name === 'grant' && !ok) detail = 'This device has no spending permission yet. Set it up: Wallet → Update device setup, or devnet-dvpn device setup --yes.';
    // The kill-switch row is OK with a status note; "nothing held" is the normal state, not a warning
    // (owner's laptop 2026-10-22 showed it as "!").
    if (name === 'kill_switch' && ok && /no persisted kill switch/i.test(detail)) detail = 'Nothing held: internet is not blocked.';
    // cb33 rows carry a severity (ok = severity != "error"): it decides. Its normal kill-switch note
    // ("belongs to the running daemon's session; checks run unpinned") is severity ok, and a real
    // leftover says "left over" (two words), so text matching got both wrong. QA, Linux port.
    const sev = typeof r.severity === 'string' ? r.severity.toLowerCase() : null;
    if (sev) return { name, ok, level: sev === 'error' || !ok ? 'fail' : sev === 'warning' ? 'warn' : 'ok', detail };
    // Pre-cb33 daemons: no severity.
    if (name === 'kill_switch' && ok) return { name, ok, level: /unpinned|unusable|leftover/i.test(detail) ? 'warn' : 'ok', detail };
    return { name, ok, level: !ok ? 'fail' : detail && ADVISORY.test(name) ? 'warn' : 'ok', detail };
  });
}

export function runDoctor(home = deviceRecord()?.home ?? DEFAULT_DAEMON_HOME): Promise<DoctorCheck[]> {
  return new Promise((resolve) => {
    const exe = dvpndPath();
    if (!fs.existsSync(exe)) { resolve([{ name: 'binary', ok: false, level: 'fail', detail: 'The VPN service program is not installed with this app.' }]); return; }
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

export function initDevice(owner: string): Promise<{ ok: boolean; device?: string; error?: string }> {
  const existing = deviceRecord();
  if (existing && existing.owner === owner) return Promise.resolve({ ok: true, device: existing.device });
  const exe = dvpndPath();
  if (!fs.existsSync(exe)) return Promise.resolve({ ok: false, error: 'The VPN service is missing from this install. Reinstall the app.' });
  const staging = stagingHome();
  if (fs.existsSync(path.join(staging, CONFIG_FILE))) {
    return Promise.resolve({ ok: false, error: 'A half-finished setup exists. Remove it from Settings → Advanced and start again.' });
  }
  return new Promise((resolve) => {
    // cb33: `init --instance c0 --home <staging>`; no --role (the tag says client) and no socket group (the
    // service grants its pipe to the sentinel-dvpn group; setup-daemon.ps1 adds the user to it).
    execFile(exe, initArgs(staging, owner), { timeout: 60_000, windowsHide: true }, (err, stdout, stderr) => {
      const text = String(stdout);
      const at = text.indexOf('{');
      if (err || at < 0) { resolve({ ok: false, error: `Could not set up the VPN service. Try again, or send the log from Diagnostics (${(err?.message ?? String(stderr)).slice(0, 300)}).` }); return; }
      try {
        const init = JSON.parse(text.slice(at)) as { public_key: string };
        writeJson(DEVICE_FILE, { device: init.public_key, home: DEFAULT_DAEMON_HOME, owner, at: Date.now() } satisfies DeviceRecord);
        log.info('device initialised', { device: init.public_key });
        carryLiveSettings(staging);
        resolve({ ok: true, device: init.public_key });
      } catch (parseErr) {
        resolve({ ok: false, error: `Could not set up the VPN service. Try again, or send the log from Diagnostics (unreadable output: ${(parseErr as Error).message}).` });
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
  return /STATE\s*:\s*4\s+RUNNING/.test(stdout);
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
    return { status: 'ok', detail: 'service installed and running (the administrator step took longer than expected)' };
  }
  return { status: 'error', detail: 'The administrator step took too long and the VPN service is not running. Try again; if it keeps happening, send the log from Diagnostics.' };
}

/**
 * The Windows account running the app, for setup-daemon.ps1's pipe group (sentinel-dvpn). Passed
 * explicitly: under an over-the-shoulder UAC prompt the elevated script runs as another account.
 */
export function appUserAccount(env: NodeJS.ProcessEnv = process.env): string {
  return env.USERDOMAIN && env.USERNAME ? `${env.USERDOMAIN}\\${env.USERNAME}` : (env.USERNAME ?? '');
}

/** setup-daemon.ps1 says "relogin-needed" when it just added the user to the pipe group (Windows applies it at sign-in). */
export const needsRelogin = (detail: string | undefined): boolean => /relogin-needed/.test(detail ?? '');

/** Elevated: move the staged home into ProgramData and run it as the sentinel-dvpnd$c0 service. Call after device setup. */
export async function installService(): Promise<{ ok: boolean; error?: string; data?: { relogin: boolean } }> {
  const rec = deviceRecord();
  if (!rec) return { ok: false, error: 'Initialise the device first.' };
  const r = await runElevated(scriptPath('setup-daemon.ps1'), { Dvpnd: dvpndPath(), Staging: stagingHome(), DaemonHome: rec.home, Service: DAEMON_SERVICE, BinRoot: path.dirname(binPath('x')), User: appUserAccount() }, undefined, verifyInstalled);
  relinkDaemon();
  if (r.status !== 'ok') return { ok: false, error: r.detail };
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
    if (/FAILED 1060/.test(q.out)) return 'no-service';
    if (/STATE\s*:\s*4\s+RUNNING/.test(q.out)) return 'running';
    const s = await sc(['start', service]);
    if (s.code === 0 || /FAILED 1056/.test(s.out)) { relinkDaemon(); return 'started'; }  // 1056 = already running
    if (/FAILED 5:/.test(s.out)) return 'no-right';
    log.warn('service start failed', { out: s.out.slice(0, 300) });
    return 'failed';
  })();
}

/** Read the device public key of an existing home (`sentinel-dvpnd key list`: the operator key). Fails when its key folder is admin-only. */
export function detectDevice(home = DEFAULT_DAEMON_HOME): Promise<{ ok: boolean; device?: string; error?: string }> {
  const exe = dvpndPath();
  if (!fs.existsSync(exe)) return Promise.resolve({ ok: false, error: 'The VPN service is missing from this install. Reinstall the app.' });
  return new Promise((resolve) => {
    execFile(exe, keyListArgs(home), { timeout: 20_000, windowsHide: true }, (err, stdout, stderr) => {
      const text = String(stdout);
      const at = text.indexOf('[');
      if (err || at < 0) { resolve({ ok: false, error: `Could not read the service's device key (${(err?.message ?? String(stderr)).trim().slice(0, 160)}). Enter its address instead.` }); return; }
      try {
        const keys = JSON.parse(text.slice(at)) as Array<{ name: string; public_key: string }>;
        const dev = operatorKey(keys);
        resolve(dev ? { ok: true, device: dev.public_key } : { ok: false, error: 'The service home has no device key.' });
      } catch (parseErr) {
        resolve({ ok: false, error: `Could not read the service's device key (unreadable output: ${(parseErr as Error).message}). Enter its address instead.` });
      }
    });
  });
}

/** Record an already-initialised daemon's device key (e.g. service set up by an admin). */
export function registerDevice(device: string, owner: string, home = DEFAULT_DAEMON_HOME): void {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(device)) throw new Error('The device must be a Solana address (base58).');
  writeJson(DEVICE_FILE, { device, home, owner, at: Date.now() } satisfies DeviceRecord);
}
