// ─── rc9-e (Windows testing, live w11): a script run from $PLUGINSDIR finds every file it dot-sources ───
// rc9-d's verify ran assert-app-folder.ps1 from $PLUGINSDIR; it dot-sources setup-daemon.ps1, which dot-sources
// staging-guard.ps1 from its own folder. That file was not copied, so the verify exited 1 on every install and the
// installer aborted (exit 2, nothing installed). A text pin of the copy lines could not see it; this walks the files.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const NSH = fs.readFileSync('build/installer.nsh', 'utf8');
const SCRIPTS = 'resources/scripts';
const BS = '\\';
// `. (Join-Path $PSScriptRoot 'x.ps1')` and `. "$PSScriptRoot\x.ps1"`: a dot-source runs in the caller, so the
// file must sit beside the script that dot-sources it.
const DOT = /^\s*\.\s+(?:\(\s*Join-Path\s+\$PSScriptRoot\s+['"]([^'"]+)['"]\s*\)|["']\$PSScriptRoot[\\/]([^'"]+)["'])/gm;

function dotSources(file: string, seen = new Set<string>()): Set<string> {
  const s = fs.readFileSync(path.join(SCRIPTS, file), 'utf8');
  for (const m of s.matchAll(DOT)) {
    const dep = m[1] ?? m[2];
    if (seen.has(dep)) continue;
    seen.add(dep);
    dotSources(dep, seen);
  }
  return seen;
}

/** Each run of "$PLUGINSDIR\x.ps1" in the installer, with the text before it (the copies it can rely on). */
function pluginRuns(): Array<{ script: string; before: string }> {
  const out: Array<{ script: string; before: string }> = [];
  const marker = `-File "$PLUGINSDIR${BS}`;
  let i = NSH.indexOf(marker);
  while (i !== -1) {
    const start = i + marker.length;
    out.push({ script: NSH.slice(start, NSH.indexOf('"', start)), before: NSH.slice(0, i) });
    i = NSH.indexOf(marker, start);
  }
  return out;
}
const copyLine = (file: string): string => `CopyFiles /SILENT "$INSTDIR${BS}resources${BS}resources${BS}scripts${BS}${file}" "$PLUGINSDIR"`;
// rc9-f: the gate scripts run before the unpack, so they are embedded in the installer instead.
const fileLine = (file: string): string => `File "/oname=$PLUGINSDIR${BS}${file}" "\${PROJECT_DIR}${BS}resources${BS}scripts${BS}${file}"`;
const placed = (before: string, file: string): boolean => before.includes(copyLine(file)) || before.includes(fileLine(file));

describe('rc9-e: every $PLUGINSDIR script has its dot-sources beside it', () => {
  it('positive control: the walk finds the runs and the setup-daemon -> staging-guard chain', () => {
    const runs = pluginRuns().map((r) => r.script);
    expect(runs).toContain('assert-app-folder.ps1');
    expect(runs).toContain('uninstall-cleanup.ps1');
    expect(runs).toContain('guard-app-folder.ps1');
    expect([...dotSources('assert-app-folder.ps1')]).toEqual(expect.arrayContaining(['setup-daemon.ps1', 'staging-guard.ps1']));
    expect(NSH).toContain(copyLine('setup-daemon.ps1'));
  });
  it('each script run from $PLUGINSDIR, and every file it dot-sources (transitively), is copied there before the run', () => {
    const missing: string[] = [];
    for (const r of pluginRuns()) {
      for (const f of [r.script, ...dotSources(r.script)]) if (!placed(r.before, f)) missing.push(`${r.script} needs ${f}`);
    }
    expect(missing).toEqual([]);
  });
  it('every dot-sourced file exists in resources/scripts (packaged with the app)', () => {
    for (const r of pluginRuns()) for (const f of dotSources(r.script)) expect(fs.existsSync(path.join(SCRIPTS, f)), f).toBe(true);
  });
});
