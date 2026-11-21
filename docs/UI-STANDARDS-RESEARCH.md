# UI standards research — per page

What well-known VPN apps and the platform guidelines do, page by page. Each section ends in
**We will**: the checklist the page is built and tested against. Sources are linked inline.
Written 2026-10-22 (owner: "research deeply … get everything tested end to end").

## Shared control rules (apply on every page)

- **Toggle switch vs checkbox** — a toggle is only for a change that takes effect **immediately**;
  if the person must press Apply/Next, use a checkbox. Several related choices = checkboxes.
  ([Microsoft: toggle switches](https://learn.microsoft.com/en-us/windows/apps/design/controls/toggles),
  [NN/g: toggle-switch guidelines](https://www.nngroup.com/articles/toggle-switch-guidelines/))
- Toggle labels say what is **on** when the switch is on, keywords first, no questions; keep
  On/Off as the state words. Don't mix instant toggles with fields that need a Submit button
  in one block. (NN/g, same article)
- **Radio buttons** for 2–8 mutually exclusive, related options where the person should see all
  of them; one-line labels; the current state must be explicit; never two radio groups side
  by side. Keyboard: arrows move and select. ([Microsoft: radio buttons](https://learn.microsoft.com/en-us/windows/apps/design/controls/radio-button))
- Consistency: the same kind of setting uses the same control everywhere in the app (NN/g).
- Our own rules: `docs/DESIGN.md` (tokens, one primary button per view, plain words) and
  `docs/ERROR-STANDARDS.md` (what happened / what to do / money + network state).

## Split tunnelling

### What others do (Windows)
| App | Modes | Choosing apps | Addresses | Applying | Kill switch |
|---|---|---|---|---|---|
| Mullvad | exclude only | list of installed apps, "+" per app, "Find another app" at the bottom; Microsoft Store apps can't be chosen; warns that excluded apps show your real IP | — | instant | excluded apps keep internet even in Lockdown mode |
| Proton VPN | **Exclude** or **Include** | pick from a list, or **Add** → browse to an .exe; untick to disable without removing, trash icon to remove | IPv4/IPv6 + CIDR list | **Apply** when disconnected, **Reconnect** when connected | works with Standard and Advanced kill switch on Windows |
| ExpressVPN | "only selected apps use the VPN" / "do not allow selected apps" | "+" then tick apps | — | confirm | — |
| NordVPN | "Disable VPN for selected apps" / "Enable VPN for selected apps only" (labels vary by version) | add from a list | — | — | separate **App Kill Switch** closes chosen apps when the VPN drops |
| IVPN | split tunnel + firewall exceptions (IP / subnet) | — | exceptions list | — | exceptions bypass the firewall |

Sources: [Mullvad split tunneling](https://mullvad.net/en/help/split-tunneling-with-the-mullvad-app),
[Mullvad app guide](https://mullvad.net/en/help/using-mullvad-vpn-app),
[Proton split tunneling](https://protonvpn.com/support/protonvpn-split-tunneling),
[ExpressVPN split tunneling](https://expressvpn.com/support/knowledge-hub/split-tunneling-desktop),
[CyberInsider (NordVPN labels)](https://cyberinsider.com/vpn/best/split-tunneling-vpn/),
[NordVPN kill switch](https://support.nordvpn.com/hc/en-us/articles/19509682644369-NordVPN-Kill-Switch-how-does-it-work),
[IVPN firewall exceptions](https://ivpn.net/knowledgebase/general/firewall-exceptions).

### What our engine can do (2026-10-22)
- Xray 26.3.27 (bundled): routing rule `process` matches the program that opened a connection,
  Windows + Linux ([Xray routing](https://xtls.github.io/en/config/routing.html)); binary has a
  TUN inbound (`proxy/tun`). → true per-app include/exclude once dvpnd adds a TUN inbound.
- V2Ray 5.53: TUN (`app/tun`) but no per-app rule. Hysteria2: TUN (sing-tun), no per-app rule.
- WireGuard / AmneziaWG / OpenVPN: no per-app support. dvpnd work is owned by session
  `devnet-dvpn-live-test-loop`; contract in `docs/SPLIT-TUNNEL-CONTRACT.md`.
- Today (all builds): V2Ray/Xray expose a local SOCKS proxy; apps that follow the Windows proxy
  use the VPN, others don't.

### We will
1. Mode as a **radio group** of three: Every app uses the VPN · Only chosen apps · Every app
   except chosen. A mode the current/selected protocol can't do is disabled **with the reason**.
2. App list = installed apps (Start Menu) + running apps, real icons, search, count; **checkboxes**
   (changes need Apply — Microsoft rule), "Browse for an app…" (.exe) at the end; Store apps shown
   as "can't be chosen".
3. Running apps that are ticked/unticked get "Running — restart it to apply".
4. Addresses and websites list (IPv4/IPv6/CIDR/domain), validated, untick vs remove.
5. Apply bar: **Apply** (disconnected) / **Apply and reconnect** (connected); says the service
   restarts; one UAC prompt.
6. Warning copy on exclusion: "Apps you leave out use your normal connection and show your real
   IP address" (Mullvad).
7. Kill switch interaction stated on the page (what happens to left-out apps when the VPN drops).
8. Live picture: two lanes (VPN → node flag + protocol logo / Normal connection → provider), each
   app's icon in the lane it is really using, measured, not assumed; reduced-motion fallback.
9. Per-protocol support table with each protocol's logo.
10. Every control reachable from the CLI (`split …`), same words.

## Kill switch

### What others do (Windows)
| App | Modes | Default | Blocked-state UI | LAN | With split tunnelling |
|---|---|---|---|---|---|
| Proton VPN | toggle + **Standard** (blocks only on an unexpected drop) / **Advanced** (internet only while connected, survives restart) | off; Standard when turned on | "Enable kill switch?" confirm modal | — | both modes work with split tunnelling on Windows |
| Mullvad | **Kill switch** always on (greyed toggle) + **Lockdown mode** (also blocks after Disconnect/Quit) | kill switch on, lockdown off | tray icon red dot, "BLOCKING INTERNET" on the connect screen, in-app notice | "Local network sharing" toggle | excluded apps keep internet in lockdown |
| NordVPN | **Internet Kill Switch** (two modes: only on an unexpected drop / also when you disconnect) + **App Kill Switch** (closes chosen apps on a drop) | off | confirm warning when enabling | — | — |
| ExpressVPN | **Network Lock**, "Allow access to devices on local network" | on; LAN allowed on | — | LAN checkbox, default on | — |
| IVPN | firewall **on-demand** or **always-on** (even before boot), LAN option, IP/subnet exceptions; WFP, independent of the client | — | — | allow LAN | exceptions |

Sources: [Proton kill switch](https://protonvpn.com/support/what-is-kill-switch),
[Mullvad app guide](https://mullvad.net/en/help/using-mullvad-vpn-app),
[NordVPN kill switch](https://support.nordvpn.com/hc/en-us/articles/19509682644369-NordVPN-Kill-Switch-how-does-it-work),
[ExpressVPN Network Lock](https://ExpressVPN.com/features/network-lock),
[IVPN kill switch / firewall](https://ivpn.net/knowledgebase/general/do-you-offer-a-kill-switch-or-vpn-firewall).

### Ours (dvpnd): `off` / `on` / `persist` + `allow_lan`; set by staged config + UAC + service
restart (not instant → radio + Apply, no toggle). Support per protocol from
`killSwitchBlocksProtocol` (core/session/state.ts).

### We will
1. Mode as a radio group of three cards — **Off** · **On** (blocks only when the VPN drops, like
   Proton Standard / Nord default) · **Always** (blocks whenever not connected, survives restarts,
   like Proton Advanced / Mullvad Lockdown) — each with its consequence in one line; Always asks
   for confirmation (Proton/Nord confirm on enable).
2. Live state picture: three steps (Connected → VPN drops → result) with the path the traffic
   takes for the chosen mode, the current step highlighted from live state; a clear
   **"Blocking internet"** state (Mullvad) with Restore network next to it.
3. "Allow local network" checkbox showing the LAN range it lets through (ExpressVPN/Mullvad).
4. Split-tunnelling interaction stated (which apps are let through when blocked).
5. Per-protocol support table with logos; protocols that can't do it say so before paying.
6. Restore network always reachable; CLI equivalents listed.
7. A kill-switch check: read-only on a real machine (filters present? DNS?), drop test only on a
   test VM (never on the owner's laptop — tier 3 paused).

**Status (2026-10-22):** 1–6 built (ed68b0f) and proven on a Windows VM through the page: mode On,
xray killed → 8/8 samples blocked, 0 leaked, page shows **Blocking internet** + Restore network
(19d2646 fixed the page saying "Nothing is blocked" after an unexpected end); Always (persist) proven the same way on ui-win-1. 7: read-only **Check it** card on the page (service rows kill_switch / kill_switch_backend / privileges = CLI `daemon doctor`); the drop test stays VM-only (`vm-split-ui.ps1 -Case ks`).

## Every other page

Same loop per page: what the leading Windows VPN and wallet apps do → gaps found on our page
(VM screenshots 2026-10-22) → what we built. Sources at the end of this section.

### Connect (Home)
- **Others:** Proton's home card = status, server, IP, protocol, load, data, one big connect
  button; recents and profiles under it. Mullvad: one coloured status line ("SECURE
  CONNECTION" / "BLOCKING INTERNET"), location, connect/switch. Bitmask/Tor: status must never
  claim more than is measured.
- **Gaps:** "Refunds 110 ready" counted settled deposits worth 0 while Wallet said 0.
- **Built:** status orb + "Protected" only from the measured exit IP (coverage); chips for what
  sites see / your own IP / protocol logo / DNS / country; in split-include the chip says where
  chosen apps exit. Refund stat → **Coming back** = the amount, with the deposit count as a hint.

### Servers
- **Others:** Proton: country list with search, feature icons per country (Secure Core, P2P,
  Tor), filter tabs, load. Mullvad: filter by provider/ownership, location tree. NordVPN:
  specialty-server categories.
- **Gaps:** country rows did not say which protocols they offer; "Re-sort" unexplained.
- **Built:** protocol logos on every country row and server row; filters (protocol, pricing,
  online, favourites, recent); row order frozen while probes land, "Re-sort" explains that.

### Plans
- **Others:** subscription UIs show one primary action per screen; price, period and what you
  get before the confirm (wallet confirm-summary pattern).
- **Gaps:** a gradient primary "Subscribe" on every card broke DESIGN's one-primary rule.
- **Built:** card buttons are secondary; the confirm modal carries the primary and the summary.

### Activity
- **Others:** wallet/activity lists put money that needs attention first and fold noise; Proton
  connection details show data and duration per session.
- **Gaps:** hundreds of "0 tDVPN" deposits buried the few that return money.
- **Built:** "Coming back" total; deposits with money or a Top up first; fully used deposits
  folded into one line; protocol logos on deposits, history and service sessions.

### Wallet
- **Others:** crypto wallet UX: one balance, plain names, confirm summary before signing,
  receive with QR + copy, warnings in plain words.
- **Built:** "Ready to withdraw" (was "Refundable", which clashed with Activity's numbers);
  confirm modals name network and amount.

### Settings
- **Others:** Proton groups settings by topic with a "Restore default settings"; DNS choices
  say what they do; unreachable custom DNS is flagged by several clients.
- **Built:** DNS picker checks the chosen servers live (`dns:probe` = CLI `daemon dns-check`)
  and warns before Apply when none answers; kill switch and split live on their own pages.
- **Open:** restore-defaults action.

### Diagnostics
- **Others:** NordVPN/Proton: a diagnostics report the user can copy and send; checks named in
  plain words.
- **Gaps:** raw check names ("clock skew").
- **Built:** every service check named in sentence case, unknown future names sentence-cased;
  stable `data-check` hooks; copyable redacted log.

### Node test, CLI, Onboarding
- **Onboarding:** progressive disclosure, fewest steps (Pendo, elementary OS): one choice per
  screen, defaults pre-picked, the network named on every money step.
- **Node test / CLI:** our own; same rules (plain words, one primary, logos where a protocol is
  shown, every button = a CLI command, docs/UI-CONTROLS.md).

Sources: [Proton VPN Windows app](https://protonvpn.com/support/protonvpn-windows-vpn-application),
[Mullvad provider filter](https://mullvad.net/en/blog/use-filtering-show-your-preferred-hosting-providers),
[NordVPN diagnostics](https://support.nordvpn.com/hc/en-us/articles/19920718445457),
[Tor UX: honest status](https://gitlab.torproject.org/tpo/ux/design/-/issues/170),
[Bitmask status](https://0xacab.org/leap/bitmask-vpn/-/issues/513),
[wallet UX](https://coinbound.io/how-the-best-crypto-design-agencies-handle-wallet-ux/),
[progressive onboarding](https://www.pendo.io/pendo-blog/onboarding-progressive-disclosure/),
[elementary OS onboarding](https://blog.elementary.io/get-settled-into-elementary-os-with-onboarding/).

## Design pass (2026-10-22): layout, spacing and type on every screen

Fonts stay (Outfit, Tomorrow, JetBrains Mono); their sizes, weights and case now follow one scale
(`docs/DESIGN.md` § Type). Each row was one commit; logic, copy and every `data-*` hook unchanged.

| Screen | Before | After |
|---|---|---|
| All | each screen capped its own width (`max-w-3xl`…`6xl`), right edge jumped; sizes 10–44 px ad hoc; caps headings in the display face; 34 px buttons, 30 px tabs | one 1440 px container, same edges everywhere; 8-step type scale; sentence-case 18 px section titles; 40 px controls, 32 px compact |
| Connect | hero, 3 stat cards, ~45% of the window empty | hero at 36 px, one stat strip, "Your servers" table with one-click Connect fills the rest |
| Servers | filters wrapped on 2 rows, `+` to expand, columns floating | search grows, toggle chips, chevron rows open when ≤ 3 countries, aligned columns under a header |
| Plans | three "Expired" rows on top, price-first cards, 4 full-width Subscribe | ended subscriptions fold to one line, cards lead with duration, price as a value, compact Subscribe |
| Activity | 4 stat cards, Top up mid-row, dates "10/20/2026, 8:53:38 PM", numbers left | stat strip, amount then Top up at the row end, short dates, numbers right with units in the header |
| Node test | no header on the picker, spend limit in a separate card | header row, the limit and Run test as the list's footer bar, results in a strip |
| Wallet | 3 stat cards, Receive stacked, two key-value columns | strip, QR beside the address, one aligned key-value table, sign out in the page head |
| Kill switch / Split / Settings / Diagnostics | single narrow column, checkboxes for on/off | two columns at ≥ 1280 px, switches for on/off, compact status line |
| CLI | fixed-height panels with a gap below, 100 px command cards | panels fill the window, compact rows, 32 px actions |

Measured with `scripts/ui-audit.js` in the UI smoke: 1140 findings → 6 (dark, 1180×780) and 3
(light, 1440×900); renderer errors `[]` throughout. Light-theme green, yellow and red were
darkened to reach 4.5:1.

### Review against leading VPN apps (2026-10-22, owner: "logos are not big enough", "headings have to be center with content", "the wireguard logo is messed up")

Every screen re-read from screenshots in both themes and compared with how NordVPN, Proton VPN
and Windows Settings lay out the same views.

| Finding | Fix |
|---|---|
| Page column pinned left; at 1920 px the heading and content sat against the sidebar with a band on the right | `.page` is one centred column, 1200 px at most; heading and content share its left edge |
| Protocol logos 14 px, flags ~19 × 14 px | logos 20 px in lists/tags, 24 px alone; flags 4:3 with a hairline outline, 24 × 18 (44 in the connect ring); app mark 40 px |
| WireGuard "Wi" then an outlined 9 px "WG" that smudged | name tile, body face semibold 11–12 px, no outline, logo height (OpenVPN "OVPN" the same until the owner has trademark permission) |
| Connect card: state block left, right half empty | one centred stack: ring, state, one line, actions |
| Empty sections as empty cards | one dashed line (`.empty-box`) |
| Disabled primary as a faded gradient | flat neutral button |
| Wallet sign-out in the page head | quiet last row |
| Welcome-back card with two headings | one heading, wallet as a label |
| Settings units above their inputs; a mono placeholder in Split | aligned; body face |

Audit after: dark and light at 960, 1440 and 1920 px; what remains is a short Plans list on a tall
window (devnet has five plans). The audit now accepts a centred column and skips text on a
gradient fill (it has no single colour to measure).
