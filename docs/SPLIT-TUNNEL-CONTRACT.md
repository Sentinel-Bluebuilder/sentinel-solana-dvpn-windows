# Split tunnelling + kill switch — app ↔ dvpnd contract

Agreed 2026-10-22 between the UI session (pages, services, CLI, tests) and the engine session
`devnet-dvpn-live-test-loop` (dvpnd patches + VM proofs). Both sessions share `main` in this
repo: commit small, stage per file.

## Ownership
- **UI side:** `src/renderer/src/screens/SplitTunnel.tsx`, `KillSwitch.tsx`, split
  services/IPC/CLI, page tests, docs.
- **Engine side:** dvpnd (`~/work/…` cf4c clones), `src/core/session/state.ts` capability
  helpers and `src/main/services/connection.ts`. It doesn't edit the two pages.

## Config (client `config.toml`, staged file + `apply-daemon-config.ps1` + service restart)
```toml
[split]
mode   = 'off'        # 'off' | 'include' | 'exclude'
apps   = []           # full .exe paths
routes = []           # CIDR only for now (IPv4/IPv6); domains later
```
There's no gRPC settings call (UPSTREAM-GAPS #2). The app writes the file the same way as the
kill switch and DNS settings.

## Capability: dvpnd build tag → support
There's no capability call. `state.ts` maps the daemon version (`ddvN`) to support, like
`daemonFixesKillSwitch`. The engine session sends each tag as it lands. Until a tag says
otherwise, the UI shows the feature as **not available for that protocol** and never shows a
control that does nothing.

| Protocol | Per-app | Routes | Planned engine |
|---|---|---|---|
| Xray | include + exclude | yes | TUN inbound + routing `process` rules + direct outbound bound to the physical NIC |
| V2Ray | via SOCKS / system proxy only | yes | routing rules |
| Hysteria2 | via SOCKS / system proxy only | yes | routing rules |
| WireGuard / AmneziaWG | not yet (WFP per-app, last) | yes | AllowedIPs |
| OpenVPN | not yet (WFP per-app, last) | yes | route lines |

Engine order: ddv5 kill switch × WG/AWG/OVPN (done, `daemonFixesKillSwitch`) → ddv6 NRPT DNS
→ #41 (dead protocol process keeps the kill switch) → split.

## Kill switch × split (decided)
- **On/Always + include:** chosen apps fail closed (blocked on the network card if the VPN
  drops). Other apps go direct.
- **On/Always + exclude:** excluded apps are allowed on the network card by an app-id WFP
  filter. Everything else uses the tunnel or is blocked.
- Off: no blocking. Chosen/left-out apps follow the mode while connected.
