// ─── Run the pre-cb33 -> cb33 home upgrade (Windows, elevated) ───
// planHomeMigration (core/daemon/migrate-home.ts) decides; this runs its steps. The installer calls it as
// `devnet-dvpn daemon migrate --yes --legacy-dvpnd <old dvpnd.exe>` (already elevated), before setup-daemon.ps1
// installs the sentinel-dvpnd$c0 service on the migrated home. Every system call is injectable so the unit test
// never touches a service, a key folder or a real binary.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readToml, renderServiceConfig, TUN_SERVICES } from '../../core/daemon/config';
import { CONFIG_FILE, legacyHome } from '../../core/daemon/layout';
import { migratedConfig, planHomeMigration, type HomeView, type MigrationPlan } from '../../core/daemon/migrate-home';

export interface MigrateIo {
  view: HomeView;
  mkdir(dir: string): void;
  copyFile(from: string, to: string): void;
  writeFile(file: string, text: string): void;
  /** Run a program; resolves with its exit code and output (never rejects). */
  run(exe: string, args: string[]): Promise<{ code: number; out: string }>;
  exists(file: string): boolean;
}

export interface MigrateOptions {
  /** the new daemon binary (sentinel-dvpnd.exe) */
  dvpnd: string;
  /** the OLD dvpnd.exe the installer saved before the update removed it; releases a persist kill switch */
  legacyDvpnd?: string;
  programData?: string;
}

export type MigrateResult =
  | { status: 'skipped'; reason: string }
  | { status: 'migrated'; from: string; to: string; device?: string; log: string[] }
  | { status: 'failed'; step: string; error: string; log: string[] };

/** The owner the old home was set up for (top-level `owner` in its client config). */
export function legacyOwner(view: HomeView, goos: 'win32' = 'win32'): string | null {
  const text = view.read(`${legacyHome(goos)}\\client\\${CONFIG_FILE}`);
  const owner = text === null ? null : readToml(text, '', 'owner');
  return typeof owner === 'string' && owner ? owner : null;
}

export async function runHomeMigration(opts: MigrateOptions, io: MigrateIo = realIo()): Promise<MigrateResult> {
  const owner = legacyOwner(io.view);
  if (!owner) return { status: 'skipped', reason: io.view.exists(legacyHome('win32')) ? 'old home has no owner' : 'no-old-home' };
  const plan: MigrationPlan = planHomeMigration('win32', owner, io.view, { programData: opts.programData });
  if (!plan.migrate) return { status: 'skipped', reason: plan.reason === 'key-conflict' ? `key-conflict: ${plan.detail}` : plan.reason };
  const log: string[] = [];
  for (const step of plan.steps) {
    try {
      if (step.kind === 'uninstall-old-service') {
        const q = await io.run('sc.exe', ['query', step.service]);
        if (/FAILED 1060/.test(q.out)) { log.push(`old service ${step.service}: not installed`); continue; }
        // The old binary's uninstall releases a persist kill switch the old service still holds (gap #84).
        if (opts.legacyDvpnd && io.exists(opts.legacyDvpnd)) {
          const r = await io.run(opts.legacyDvpnd, ['service', 'uninstall']);
          log.push(`old service ${step.service}: uninstalled with the old binary (exit ${r.code})`);
          if (r.code !== 0) throw new Error(`The old service uninstall failed: ${r.out.trim().slice(0, 300)}`);
        } else {
          await io.run('sc.exe', ['stop', step.service]);
          const d = await io.run('sc.exe', ['delete', step.service]);
          log.push(`old service ${step.service}: no old binary, deleted with sc.exe (exit ${d.code}); a held block may need Diagnostics`);
        }
      } else if (step.kind === 'copy-key') {
        io.mkdir(path.win32.dirname(step.to));
        io.copyFile(step.from, step.to);
        log.push(`device key copied to ${step.to}`);
      } else if (step.kind === 'init') {
        const r = await io.run(opts.dvpnd, step.args);
        if (r.code !== 0) throw new Error(`Setting up the new service home failed: ${r.out.trim().slice(0, 300)}`);
        log.push('new instance initialised (same device key)');
      } else if (step.kind === 'carry-settings') {
        const fresh = io.view.read(step.into);
        if (fresh === null) throw new Error(`Setting up the new service home wrote no ${step.into}`);
        io.writeFile(step.into, migratedConfig(io.view.read(step.oldRoot), io.view.read(step.oldClient), fresh));
        // Whole-device mode: <old>\client\<svc>\config.toml -> <new>\<svc>\config.toml, only the tun choice.
        for (const s of TUN_SERVICES) {
          const from = io.view.read(`${plan.from}\\client\\${s}\\${CONFIG_FILE}`);
          const into = `${plan.to}\\${s}\\${CONFIG_FILE}`;
          const there = io.view.read(into);
          const tun = from === null ? null : readToml(from, '', 'tun');
          if (typeof tun !== 'boolean' || there === null) continue;
          io.writeFile(into, renderServiceConfig(there, tun));
        }
        log.push('settings carried (kill switch On is kept as On across restarts)');
      } else {
        log.push(`old home kept at ${step.path}`);
      }
    } catch (err) {
      return { status: 'failed', step: step.kind, error: (err as Error).message, log };
    }
  }
  return { status: 'migrated', from: plan.from, to: plan.to, log };
}

function realIo(): MigrateIo {
  return {
    view: {
      exists: (p) => fs.existsSync(p),
      // Missing = null; a file that exists but cannot be read throws (an unreadable key is not "no key").
      read: (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null),
    },
    mkdir: (d) => fs.mkdirSync(d, { recursive: true }),
    copyFile: (a, b) => fs.copyFileSync(a, b, fs.constants.COPYFILE_EXCL),
    writeFile: (f, t) => fs.writeFileSync(f, t, 'utf8'),
    exists: (f) => fs.existsSync(f),
    run: (exe, args) => new Promise((resolve) => {
      execFile(exe, args, { timeout: 120_000, windowsHide: true }, (err, stdout, stderr) => {
        const code = err ? (typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? Number((err as { code: number }).code) : 1) : 0;
        resolve({ code, out: `${String(stdout)}${String(stderr)}` });
      });
    }),
  };
}
