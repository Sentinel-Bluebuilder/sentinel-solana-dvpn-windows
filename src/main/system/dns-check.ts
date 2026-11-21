// ─── Is DNS really left over after a session? (F15, UPSTREAM-GAPS #25) ───
// dvpnd on Windows sets the VPN's DNS servers on the TUNNEL interface, and on stop removes
// the tunnel first and then runs `netsh … set dnsservers dhcp` on the interface that no
// longer exists. netsh fails, and the daemon reports dns_revert_failed although Windows
// DNS is fine (clean-VM run 2026-10-20). Before alarming the user, look: a real leftover is
// one of the VPN's DNS servers still set on a live, non-VPN adapter.
import { execFile } from 'node:child_process';
import { log } from '../logger';

export interface AdapterDns { alias: string; servers: string[] }

/** Pure decision, exported for tests. */
export function leftoverDns(adapters: AdapterDns[], vpnServers: string[]): AdapterDns[] {
  const ours = new Set(vpnServers.map((s) => s.trim().toLowerCase()).filter(Boolean));
  if (!ours.size) return [];
  return adapters.filter((a) => !/^dvpn-/i.test(a.alias) && a.servers.some((s) => ours.has(s.toLowerCase())));
}

/** Parse `Get-DnsClientServerAddress | ConvertTo-Json` (object or array). Exported for tests. */
export function parseAdapterDns(json: string): AdapterDns[] {
  const raw = JSON.parse(json.replace(/^﻿/, '') || '[]') as unknown;
  const rows = (Array.isArray(raw) ? raw : [raw]) as Array<{ InterfaceAlias?: string; ServerAddresses?: string[] | string }>;
  return rows
    .filter((r) => r && r.InterfaceAlias)
    .map((r) => ({ alias: String(r.InterfaceAlias), servers: Array.isArray(r.ServerAddresses) ? r.ServerAddresses : r.ServerAddresses ? [r.ServerAddresses] : [] }));
}

function adapterDns(): Promise<AdapterDns[]> {
  const cmd = 'Get-DnsClientServerAddress | Where-Object { $_.ServerAddresses } | Select-Object InterfaceAlias, ServerAddresses | ConvertTo-Json -Compress';
  const env = { ...process.env };
  delete env.PSModulePath; // a PowerShell 7 parent breaks 5.1's module autoload
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { timeout: 15_000, windowsHide: true, env }, (err, stdout) => {
      if (err) { reject(err); return; }
      try { resolve(parseAdapterDns(String(stdout).trim())); } catch (parseErr) { reject(parseErr); }
    });
  });
}

/**
 * true = the VPN's DNS is still set somewhere (tell the user), false = the daemon's
 * report was a false alarm. Unknown (not Windows, no servers, check failed) = true.
 */
export async function dnsReallyLeftOver(vpnServers: string[] | undefined): Promise<boolean> {
  if (process.platform !== 'win32' || !vpnServers?.length) return true;
  try {
    const left = leftoverDns(await adapterDns(), vpnServers);
    if (left.length) log.warn('VPN DNS still set', { adapters: left.map((a) => a.alias) });
    else log.info('dns_revert_failed was a false alarm: no adapter keeps the VPN DNS');
    return left.length > 0;
  } catch (err) {
    log.warn('DNS leftover check failed', { err: (err as Error).message });
    return true;
  }
}

/**
 * Drop Windows' DNS cache after a tunnel comes up or goes down. Answers (and failures)
 * cached on the old path are wrong for the new one: a lookup made in the first second of a
 * session fails and stays failed for a while. Same as `ipconfig /flushdns`; needs no admin.
 * Fire and forget, logged.
 */
/** What a failed flush is logged with (row 134: the owner's log had 14 of these carrying only "Command failed",
 *  so none could be explained). ipconfig prints its reason on stdout, so both streams are kept, cut short. */
export function flushFailure(err: Error, stdout: unknown, stderr: unknown): Record<string, unknown> {
  const e = err as Error & { code?: number | string | null; signal?: string | null; killed?: boolean };
  const cut = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return { err: e.message.split('\n')[0], code: e.code ?? null, signal: e.signal ?? null, timedOut: e.killed === true, stdout: cut(stdout), stderr: cut(stderr) };
}

/** Row 134, the reason found once it was logged (owner's laptop, build 9bf682c): "The requested operation
 *  requires elevation". This Windows does not let a standard user clear the DNS cache, and the app never raises
 *  an administrator prompt for it. That is not a fault of this run: said once at info, and not tried again
 *  until the app restarts. Any other failure is still a warning. */
export const flushNeedsAdmin = (f: Record<string, unknown>): boolean => /requires elevation|access is denied/i.test(`${String(f.stdout)} ${String(f.stderr)} ${String(f.err)}`);
let flushNotAllowed = false;
/** Tests: forget that this Windows refused the flush. */
export const resetFlushState = (): void => { flushNotAllowed = false; };

export function flushDnsCache(): void {
  if (process.platform !== 'win32' || flushNotAllowed) return;
  execFile('ipconfig.exe', ['/flushdns'], { timeout: 10_000, windowsHide: true }, (err, stdout, stderr) => {
    if (!err) return;
    const f = flushFailure(err, stdout, stderr);
    if (flushNeedsAdmin(f)) {
      flushNotAllowed = true;
      log.info('this Windows lets only an administrator clear the DNS cache; skipped from now on (the first lookups after a connect may be slow)', f);
      return;
    }
    log.warn('flushing the DNS cache failed', f);
  });
}
