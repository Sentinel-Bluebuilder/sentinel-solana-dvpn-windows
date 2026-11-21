// ─── One UAC prompt per privileged step (D4, F1.5) ───
// Runs a bundled PowerShell script elevated via Start-Process -Verb RunAs. Only
// file paths and validated tokens go on the command line — never config text
// (M5.3 #8). The script reports through a JSON result file we read back.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { log } from '../logger';
import { tr } from '../../shared/i18n';

// ( ) allowed for "C:\Program Files (x86)\…" (W-ARM-INST-X86: older ARM64 installs live there).
// Safe: the line sits in a single-quoted PowerShell string and -File passes args literally;
// no quote, $, ;, ` or & is allowed, so nothing is evaluated.
// CODE-AUDIT U-16: letters, marks and digits of any script, because the result file and staged paths sit under
// C:\Users\<name>\ (José, Müller, 李 made every admin step refuse). Letters are inert in the single-quoted line.
const SAFE_ARG = /^[\p{L}\p{M}\p{N} _.:\\/()-]+$/u;
// The one `$` we need: the Windows service name `sentinel-dvpnd$c0` (instance tag after `$`).
// Anchored to that exact shape; the single-quoted line never evaluates it (Q0478 SAFE_ARG finding).
const SERVICE_ARG = /^sentinel-dvpnd\$[a-z0-9]+$/;

export interface ElevatedResult { status: 'ok' | 'error' | 'cancelled'; detail: string; code?: string; [k: string]: unknown }

/** Double-quoted for the elevated command line. SAFE_ARG has no quotes, so nothing can break out. */
function dq(s: string): string {
  if (!SAFE_ARG.test(s) && !SERVICE_ARG.test(s)) throw new Error(`refusing unsafe argument for elevated step: ${s}`); // copy:internal
  return `"${s}"`;
}

/** The elevated process's command line (exported for tests). */
export function elevatedArgLine(script: string, args: Record<string, string>): string {
  const named = Object.entries(args).map(([k, v]) => {
    if (!/^[A-Za-z]+$/.test(k)) throw new Error(`bad parameter name ${k}`); // copy:internal
    return `-${k} ${dq(v)}`;
  });
  return ['-NoProfile', '-ExecutionPolicy Bypass', `-File ${dq(script)}`, ...named].join(' ');
}

/**
 * The unelevated PowerShell that starts the step. Already an administrator (an elevated
 * terminal, an SSH session, the installer) → run it directly: no prompt, and no RunAs,
 * which fails in a session without a desktop. Otherwise one UAC prompt.
 * The arg line is single-quoted; it holds no single quotes (SAFE_ARG). Exported for tests.
 */
export function elevatedOuterCommand(line: string): string {
  return [
    `$a = '${line}'`,
    '$admin = (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
    // ONE element: joined with '; ', a separate 'else' became an unknown command, so a user who was
    // not already admin never got the UAC prompt (owner's laptop 2026-11-11: "'else' is not recognized").
    // WIN-W4 (the agent tools rc.9): with no desktop (a standard user over SSH, a task) RunAs throws at once and no prompt shows;
    // it says so on stderr (runas-failed, exit 87) so the caller does not report a declined prompt.
    "if ($admin) { $p = Start-Process -FilePath powershell.exe -WindowStyle Hidden -Wait -PassThru -ArgumentList $a } else { try { $p = Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList $a } catch { [Console]::Error.WriteLine('runas-failed: ' + $_.Exception.Message); exit 87 } }",
    'exit $p.ExitCode',
  ].join('; ');
}

/**
 * What to report when the step wrote no result file. A step cut off by our time limit is not a
 * declined prompt: saying so sent a user hunting for a prompt that never existed (VM ui-win-2
 * 2026-10-22: the first OpenVPN adapter install ran past 60 s with no prompt at all).
 * Exported for tests.
 */
export function noResultOutcome(timedOut: boolean, timeoutMs: number): ElevatedResult {
  if (timedOut) return { status: 'error', detail: tr('The admin step did not finish within {timeoutMs} s. Try again; a first-time driver setup can be slow.', { timeoutMs: Math.round(timeoutMs / 1000) }) };
  return { status: 'cancelled', detail: tr('The Windows permission prompt was declined or closed.') };
}

/** WIN-W4: the outer step's stderr says RunAs could not start (no desktop): needs-admin, or null. Exported for tests. */
export function runasFailure(stderr: string): ElevatedResult | null {
  if (!/runas-failed/.test(stderr)) return null;
  return {
    status: 'error', code: 'needs-admin',
    detail: tr('Windows could not show the administrator prompt here (no desktop, e.g. an SSH session). Run it from an elevated shell or an administrator SSH login. Nothing was changed.'),
  };
}

/** Run `script` elevated with named args; resolves with its result JSON. */
/**
 * How long an admin step may take. 120 s by default. A test VM that emulates the CPU (QEMU TCG
 * ARM64: each CLI call ~140 s) sets DVPN_ELEVATE_TIMEOUT_MS, like DVPN_DRIVER_CHECK_TIMEOUT_MS.
 */
export function elevateTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const v = Number(env.DVPN_ELEVATE_TIMEOUT_MS);
  return Number.isFinite(v) && v >= 10_000 && v <= 900_000 ? Math.round(v) : 120_000;
}

/** How long to keep waiting for a timed-out step's own result: 180 s, or DVPN_ELEVATE_GRACE_MS (0–900 s). */
export function resultGraceMs(env: NodeJS.ProcessEnv = process.env): number {
  const v = Number(env.DVPN_ELEVATE_GRACE_MS);
  return env.DVPN_ELEVATE_GRACE_MS !== undefined && Number.isFinite(v) && v >= 0 && v <= 900_000 ? Math.round(v) : 180_000;
}

/** Resolves true once `file` exists, false after `ms`. Exported for tests. */
export async function waitForFile(file: string, ms: number, everyMs = 1000): Promise<boolean> {
  const end = Date.now() + ms;
  for (;;) {
    if (fs.existsSync(file)) return true;
    if (Date.now() >= end) return false;
    await new Promise((r) => setTimeout(r, Math.min(everyMs, Math.max(1, end - Date.now()))));
  }
}

/**
 * L6: a step cut off by our time limit may still have finished its work (the helper keeps running
 * with admin rights after we kill the launcher). `verify` checks the real outcome; when it returns a
 * result, that replaces the timeout error. Exported for tests.
 */
export async function settleTimedOut(r: ElevatedResult, timedOut: boolean, verify?: () => Promise<ElevatedResult | null>): Promise<ElevatedResult> {
  if (!timedOut || r.status !== 'error' || !verify) return r;
  try {
    return (await verify()) ?? r;
  } catch (err) {
    log.warn('post-timeout verification failed', { err: String(err) });
    return r;
  }
}

export async function runElevated(script: string, args: Record<string, string>, timeoutMs = elevateTimeoutMs(), verify?: () => Promise<ElevatedResult | null>): Promise<ElevatedResult> {
  const result = path.join(os.tmpdir(), `devnet-dvpn-${randomBytes(6).toString('hex')}.json`);
  const line = elevatedArgLine(script, { ...args, Result: result });
  const outer = elevatedOuterCommand(line);
  log.info('elevated step', { script: path.basename(script) });
  // Started from a PowerShell 7 window, PSModulePath points at 7's modules; Windows
  // PowerShell 5.1 then fails to load Get-Service / Get-FileHash and our scripts misread
  // the empty results. Drop it so 5.1 rebuilds its own default.
  const env = { ...process.env };
  delete env.PSModulePath;
  let timedOut = false;
  let errText = '';
  await new Promise<void>((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', outer], { timeout: timeoutMs, windowsHide: true, env }, (err, _stdout, stderr) => {
      if (err) {
        timedOut = Boolean((err as { killed?: boolean }).killed);
        errText = String(stderr);
        log.warn('elevated step returned an error', { script: path.basename(script), timedOut, timeoutMs, code: (err as NodeJS.ErrnoException).code, stderr: String(stderr).slice(0, 400) });
      }
      resolve();
    });
  });
  // Our time limit kills only the outer PowerShell: the elevated step keeps running and may still
  // finish (or roll back) and write its result. Wait for that before calling it a failure
  // (fleet-bugs #3: a slow machine reported "did not finish" for a change that had applied).
  if (timedOut && !fs.existsSync(result)) await waitForFile(result, resultGraceMs());
  const noDesktop = !timedOut && !fs.existsSync(result) ? runasFailure(errText) : null;
  if (noDesktop) { log.warn('elevated step: RunAs could not start (no desktop)', { script: path.basename(script) }); return noDesktop; }
  if (!fs.existsSync(result)) return await settleTimedOut(noResultOutcome(timedOut, timeoutMs), timedOut, verify);
  try {
    return JSON.parse(fs.readFileSync(result, 'utf8').replace(/^﻿/, '')) as ElevatedResult;
  } finally {
    fs.rmSync(result, { force: true });
  }
}
