// ─── Start with the OS, from the CLI (shared info-cmd seam, the macOS app) ───
// Windows: the app applies "Start with Windows" itself when it runs (Electron login item), so a CLI
// change takes effect the next time the app opens; nothing to write here and nothing extra to say.

/** Applies startWithOs now when this OS can from the CLI; returns a note for the user, or null. */
export function applyStartWithOsFromCli(_on: boolean): string | null {
  return null;
}
