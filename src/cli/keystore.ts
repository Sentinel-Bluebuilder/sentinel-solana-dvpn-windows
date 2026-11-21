// ─── CLI key store ───
// DVPN_KEYFILE (or --keyfile) points at a solana-keygen JSON that is used in
// place and never copied — how tests use the devnet wallet. Otherwise the key is
// kept in <data>/wallet.cli.dpapi, protected with Windows DPAPI (current user)
// through PowerShell, so a CLI-imported key is not left in plain text.
import { cliErr, CLI_NAME } from './cli-fail';
import fs from 'node:fs';
import os from 'node:os';

/** KWIN-SID (the agent tools rc9-c, Windows testing w11 live): this account's SID from `whoami /user /fo csv /nh` ("pc\\name","S-1-5-21-..."),
 *  read once; null when whoami fails or prints no SID. The runner is injected in tests. */
let sidRead: string | null | undefined;
export function windowsSid(run: () => string = () => execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true, timeout: 5000 })): string | null {
  if (sidRead !== undefined) return sidRead;
  try {
    sidRead = /"(S-1-[0-9-]+)"/.exec(run())?.[1] ?? null;
  } catch (err) {
    log.warn('keyfile: whoami /user failed; the icacls line names the account', { err: (err as Error).message });
    sidRead = null;
  }
  return sidRead;
}

/** KWIN-USER + KWIN-SID (the agent tools rc.9): this Windows account as icacls takes it, written into the line (PowerShell never
 *  expands %USERNAME%). The SID (`*S-1-...`) first: over SSH on a workgroup PC USERDOMAIN is WORKGROUP and
 *  "WORKGROUP\\user" has no mapping. Without a SID: the name, with no WORKGROUP prefix. Exported for tests. */
export function windowsAccount(env: NodeJS.ProcessEnv = process.env, sid: string | null = process.platform === 'win32' ? windowsSid() : null): string {
  if (sid) return `*${sid}`;
  const user = env.USERNAME || os.userInfo().username;
  return env.USERDOMAIN && env.USERDOMAIN.toUpperCase() !== 'WORKGROUP' ? `${env.USERDOMAIN}\\${user}` : user;
}
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Keypair } from '@solana/web3.js';
import { keypairFromInput, keypairToJson } from '../core/wallet/keys';
import type { KeyStore } from '../main/host';
import { log } from '../main/logger';

function dpapi(mode: 'protect' | 'unprotect', b64: string): string {
  const op = mode === 'protect' ? 'Protect' : 'Unprotect';
  const script = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); $o=[System.Security.Cryptography.ProtectedData]::${op}($b,$null,'CurrentUser'); [Convert]::ToBase64String($o)`;
  try {
    // stderr piped, not inherited: by default execFileSync also copies it to our console, so the
    // raw "Exception calling Protect" printed above the plain message (cli191 ddv-win-2).
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input: b64, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    // A logon without a password (SSH key login, some service accounts) has no DPAPI user
    // key: Windows answers "Access is denied" (clean-VM run 2026-10-20).
    if (/Access is denied/i.test(String((err as { stderr?: unknown }).stderr ?? (err as Error).message))) {
      throw cliErr('keystore-unavailable', `${CLI_NAME} wallet create --keyfile <path> --yes`, 'Windows cannot encrypt a wallet for this logon (no password session, e.g. an SSH key login). Use a key file instead: --keyfile <path> or DVPN_KEYFILE.');
    }
    throw cliErr('keystore-unavailable', `${CLI_NAME} wallet create --keyfile <path> --yes`, `Windows wallet encryption failed: ${(err as Error).message.split('\n')[0]}`);
  }
}

/** E-EP (the agent tools rc.9): the one command that lets this user read its key file again, then wallet show. */
export function keyfileUnreadableNext(file: string, platform: string = process.platform): string {
  return platform === 'win32'
    ? `icacls "${file}" /grant "${windowsAccount()}:R", then ${CLI_NAME} wallet show --json` // KWIN-USER
    : `sudo chown $(id -un) ${shellWord(file)} && chmod 600 ${shellWord(file)}, then ${CLI_NAME} wallet show --json`; // rc.10: one shell word
}

/** E-EP: reads the key file; a file this user may not read is keyfile-unreadable (it was the raw EPERM / EACCES). */
export function readKeyfile(file: string, read: (f: string) => string = (f) => fs.readFileSync(f, 'utf8')): string {
  try {
    return read(file);
  } catch (err) {
    const c = (err as NodeJS.ErrnoException).code;
    if (c === 'EACCES' || c === 'EPERM') throw cliErr('keyfile-unreadable', keyfileUnreadableNext(file), `The key file ${file} cannot be read by this user (${c}). Nothing was sent or signed.`);
    throw err;
  }
}

export function cliKeyStore(dataDir: string, keyfile?: string): KeyStore {
  if (keyfile) {
    return {
      kind: 'keyfile',
      path: keyfile, // E-18: noWallet() names the missing file
      exists: () => fs.existsSync(keyfile),
      load: (): Keypair | null => (fs.existsSync(keyfile) ? keypairFromInput(readKeyfile(keyfile)) : null),
      save() { throw cliErr('keyfile-read-only', `drop --keyfile and unset DVPN_KEYFILE (PowerShell: Remove-Item Env:DVPN_KEYFILE), then run the command again`, 'A --keyfile / DVPN_KEYFILE wallet is read-only. Run without it to import or create a wallet.'); }, // AUD-2 M11
      remove() { throw cliErr('keyfile-read-only', `drop --keyfile and unset DVPN_KEYFILE (PowerShell: Remove-Item Env:DVPN_KEYFILE), then run the command again`, 'A --keyfile / DVPN_KEYFILE wallet is never deleted by this CLI.'); },
    };
  }
  const file = path.join(dataDir, 'wallet.cli.dpapi');
  return {
    // Not 'keyfile': vault.ts skips its "never replace a wallet" check only for a read-only key
    // file, and this store CAN be overwritten (VM sweep 2026-10-21: a second `wallet create
    // --yes` replaced the first wallet).
    kind: 'dpapi',
    exists: () => fs.existsSync(file),
    load(): Keypair | null {
      if (!fs.existsSync(file)) return null;
      const json = Buffer.from(dpapi('unprotect', fs.readFileSync(file, 'utf8')), 'base64').toString('utf8');
      return keypairFromInput(json);
    },
    save(kp) {
      fs.writeFileSync(file, dpapi('protect', Buffer.from(keypairToJson(kp), 'utf8').toString('base64')), 'utf8');
    },
    remove() {
      fs.rmSync(file, { force: true });
    },
  };
}

// ─── R3 gap 1 (the agent tools STATE-MATRIX): a key file other users can read is refused before any payment ───
/** The key file's mode problem (group/other bits set, POSIX only), or null. Pure over the stat; exported for tests. */
/** The one command that makes the key file readable by this user only, then the agent up line (K-WIN: per OS). */
/** A path as one shell word: unchanged when it is plain, else single-quoted (macOS key files often sit under
 *  "~/Library/Application Support", and an unquoted chmod there runs on two wrong paths). macOS testing, the macOS app 3b64e34c5. */
export const shellWord = (p: string): string => (/^[A-Za-z0-9_./@%+:=-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`);
// L4 (rc9-c2, Windows testing w11): /inheritance:r drops only inherited ACEs and /grant:r replaces only this account's grant, so
// an EXPLICIT Users / Authenticated Users / Everyone ACE survived and this next looped. /remove:g takes out every group
// keyfileModeProblem refuses (OPEN_ACE), by SID, in the same one command.
export const WIN_OPEN_GROUP_SIDS = ['*S-1-1-0', '*S-1-5-11', '*S-1-5-32-545'] as const;
export const keyfileModeNext = (file: string, platform: string = process.platform, account: string = windowsAccount()): string => platform === 'win32'
  ? `icacls "${file}" /inheritance:r /remove:g ${WIN_OPEN_GROUP_SIDS.join(' ')} /grant:r "${account}:F", then ${CLI_NAME} agent up --yes`
  : `chmod 600 ${shellWord(file)}, then ${CLI_NAME} agent up --yes`;

/** K-WIN (the agent tools rc.9): reads a file's ACL on Windows. Injected in tests. */
export type AclRunner = (file: string) => string;
const icacls: AclRunner = (file) => execFileSync('icacls', [file], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
// The groups every local account is in (names, or the bare SIDs icacls prints when it cannot resolve them): an allow
// ACE for one of them lets other users read the wallet key. The first ACE sits on the line with the file path.
const OPEN_ACE = /(?:^|\s)(BUILTIN\\Users|Everyone|NT AUTHORITY\\Authenticated Users|\*?S-1-5-32-545|\*?S-1-1-0|\*?S-1-5-11):((?:\([^)]*\))+)/gi;

/** The first allow ACE in `icacls` output that opens the file to all local users, as icacls prints it; or null. */
export function openAce(icaclsOut: string): string | null {
  for (const m of icaclsOut.matchAll(OPEN_ACE)) if (!/\(DENY\)/i.test(m[2])) return `${m[1]}:${m[2]}`;
  return null;
}

export function keyfileModeProblem(file: string | undefined, platform: NodeJS.Platform = process.platform, statMode?: number, acl: AclRunner = icacls): { path: string; mode: string } | null {
  if (!file) return null;
  if (platform === 'win32') {
    // K-WIN: there is no mode on Windows; the ACL says who can read it. A failed read never blocks (fail-open).
    let out: string;
    try { out = acl(file); } catch (err) { log.warn('key file ACL not read (icacls); not checked', { file, err: (err as Error).message }); return null; }
    const ace = openAce(out);
    return ace ? { path: file, mode: ace } : null;
  }
  let mode = statMode;
  if (mode === undefined) {
    try { mode = fs.statSync(file).mode; } catch (err) { return null; /* a missing file is keyfile-missing, named elsewhere */ }
  }
  return (mode & 0o077) ? { path: file, mode: (mode & 0o777).toString(8) } : null;
}
