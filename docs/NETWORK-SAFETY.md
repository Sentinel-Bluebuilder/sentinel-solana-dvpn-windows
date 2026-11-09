# Network safety — everything that can touch this computer's internet

The owner's rule: nothing in this app, its CLI or its tests may leave a computer
without internet. This file lists **every** code path that changes host networking,
the guard on each, and how it is tested. A new path that is not listed here is a bug.

## The paths

| # | What changes | Who changes it | When it is undone | Guard | Tested by |
|---|---|---|---|---|---|
| 1 | Tunnel, routes, kill-switch firewall rules, DNS | `dvpnd` service only (the app never touches them) | Session stop (Disconnect, quit, Restore network); daemon releases a non-persist kill switch after its 5 reconnect attempts fail | App quits only after `StopSession` (10 s cap); `Restore network` in Connect + Diagnostics + CLI `daemon restore-network`; `dns_revert_failed` → red banner with Restore network | WSL netns rig (`scripts/e2e/wsl-rig.sh`): restore-network left no nft tables; Windows egress checked 200 before/after every run |
| 2 | Kill-switch **mode** (`off` / `on` / `persist`) | User, Settings → VPN service (elevated `apply-daemon-config.ps1` + service restart) | User changes it back | Daemon default is `on` (blocks only while a session is up or reconnecting). `persist` copy says plainly it can leave you offline. Split tunnelling requires `off` and says so | `validateSettings` unit tests; CLI `daemon set` stops for `--yes` (cli-e2e daemon tier) — **never applied on the dev laptop** |
| 3 | Windows system proxy (HKCU `ProxyEnable`/`ProxyServer`) | App, only on the user's toggle **and only while a V2Ray/Xray session exposes a loopback SOCKS endpoint** | Session end (any reason), Disconnect, Restore network, app quit, next app start (crash recovery), uninstall | Refuses non-loopback endpoints; refuses with no SOCKS session; saves the user's own values first and restores them exactly; only undoes the value if it is still ours | `tests/unit/main-services.test.ts` (fake registry: save/restore/only-ours, non-loopback refusal); cli-e2e local tier asserts the real registry has no `socks=127…`; uninstall script tested against a non-matching backup (registry unchanged) |
| 4 | The `dvpnd` Windows service | One elevated step in first run (`setup-daemon.ps1`), after device setup | Uninstall (`uninstall-cleanup.ps1` via `build/installer.nsh`): graceful stop → session ends, kill switch + DNS released → `service uninstall` | Never installed by tests on this machine; cli-e2e asserts no running `dvpnd` service | cli-e2e local tier |
| 5 | Connect on launch | App, opt-in setting | — | Once per start; never when the daemon still holds a session (adopted instead) or a previous run left a Restore-network warning; never in UI smoke runs | code review (`services/auto-connect.ts`) |

Nothing else in the codebase calls `netsh`, `route`, `reg add`, firewall APIs or
adapter APIs. Check with:
`grep -rnE "netsh|route add|New-NetFirewall|execFile\(.reg|Set-ItemProperty|Set-DnsClient" src resources/scripts`
(expected hits: only `src/main/system/proxy.ts` and `uninstall-cleanup.ps1`).

## Test rules (this laptop)
- Paid sessions run **only** in the WSL netns rig. The tunnel and kill switch live in
  namespace `dvpnapp`; Windows and the WSL host namespace are never routed.
- `wsl-rig.sh client` = client daemon only (shared node untouched). `up` moves shared
  node `6AaXvh…`'s API — message the #1b / #29 sessions first, always `down` after.
- Never on this laptop: `daemon install --yes`, `daemon set --yes`, `proxy on --yes`
  with a real session, or any Windows-side `dvpnd start`.

## Kill switch: what the screens promise (proven 2026-10-22, VM)
- An unexpected session end with the kill switch on leaves the internet blocked by dvpnd. The
  app checks 3 s later (`checkLeftoverBlock`) and every screen then says **Blocking internet**
  with Restore network; it never says "Not connected / nothing blocked" while the block holds.
  VM test-host: xray killed → 8/8 samples blocked, 0 leaked → page state + Restore → direct.
- UI drop tests run only on a VM (`scripts/e2e/vm-split-ui.ps1 -Case ks [-KsMode persist]`).

## Known residual risks
- `persist` kill switch + a daemon that dies uncleanly can leave rules until the next
  service start (daemon re-applies, then releases on stop). Upstream gap #5 asks for a
  watchdog. The UI warns before `persist` is chosen.
- A per-machine uninstall restores the proxy of the account that approved UAC. With
  over-the-shoulder admin credentials that is the admin, not the signed-in user; the
  user's proxy is then restored on their next app start, or by hand.
- The Windows WireGuard path has not run end to end (needs a disposable VM; this laptop
  is Windows Home). Until it has, a Windows release is blocked (TEST-PLAN).
