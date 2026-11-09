# Changelog

## 0.2.0 - final release (2026-11-09)

- Built on the Sentinel Solana fork cut `final6.5` (`90014b2`): status fails fast (2 s) while the service restarts or stops (Q0469); a tunnel that receives nothing is reported within 2 s and long soaks show no false "Reconnecting" (Q0445, Q0480).
- Elevated service steps accept the Windows service name `sentinel-dvpnd$c0`, so `daemon install` / `daemon set` work again and the kill-switch setting survives a service restart (Q0478).
- Windows x64 and ARM64 installers (0.2.0, plus the 0.1.0 installers rebuilt on the same cut); the Sentinel CLI and daemon are published alongside.

## 0.2.0 - RC2 (2026-11-09)

- Built on the Sentinel Solana fork cut `final6.1` (`02b22fc`).
- RPC config writers: a stored http RPC gate is carried through every settings path; a newly entered RPC stays https-only (Q0468, Q0478).
- Windows x64 and ARM64 installers; the Sentinel CLI and daemon are published alongside.

## 0.1.0 - RC1 (2026-11-08)

- First release candidate, built on fork cut `final6`/`final6.1`.
- Per-session pay-direct and plan subscriptions, kill switch, split tunnelling, full CLI.
