# Design standard — Devnet dVPN

The look follows our design reference: a dark canvas with corner glows and card surfaces,
a structured layout with a display typeface, and gold reserved for warnings. Brand colour is the **Solana**
purple → green gradient. Tokens live in `src/renderer/src/styles/index.css`; every colour is a
token, so dark and light come from one stylesheet.

## Tokens

| token | dark | light | use |
|---|---|---|---|
| `--bg` | `#0a0b0d` | `#f6f7f9` | canvas, with purple top-left and green bottom-right glows |
| `--bg-card` / `--bg-raised` / `--bg-hover` | `#121417` / `#181b1f` / `#1e2227` | white / `#fafafc` / `#eef0f4` | cards, raised rows, hover |
| `--sol-purple` → `--sol-green` | `#9945FF` → `#14F195` | same | primary buttons, connection ring, logo, progress — brand only |
| `--accent` / `--accent-ink` | `#9945FF` / `#c096ff` | `#7c3aed` / `#6d28d9` | focus, links, active nav (light uses a darker violet for contrast) |
| `--green` | `#14F195` | `#047a4a` | Protected, online, latency (light darkened to 5.4:1 on white) |
| `--yellow` | `#ffc701` | `#926200` | warnings and the DEVNET · TEST TOKENS badge only (light 5.3:1) |
| `--red` | `#ff5a5f` | `#c4242c` | errors, destructive confirm (light 4.8:1 on its tint) |
| `--text-muted` | `rgb(128 134 144)` | `rgb(100 106 120)` | hints, meta, labels — 4.5:1 or better on cards in both themes |

Rules: no hard-coded colours in components; gradient only for brand and primary action; at most
one primary button per view; gold never for success.

## Type

| family | weight | use |
|---|---|---|
| Outfit (variable) | 400–700 | body, labels |
| Tomorrow | 600–800 | headings, big numbers, the connection title (display face) |
| JetBrains Mono (variable) | 400–500 | addresses, signatures, the CLI terminal |

**Scale** (Tailwind keys in `tailwind.config.cjs`; nothing else is allowed, nothing under 10 px):

| key | size / line / weight | use |
|---|---|---|
| `text-label` | 10 / 14 / 500, caps, 0.08em | field and column labels (`.label`, table headers) |
| `text-meta` | 12 / 16 | hints, timestamps, secondary lines |
| `text-body` / `text-sm` | 14 / 20 | body text (body is never bold) |
| `text-ctl` | 14 / 20 / 500 | buttons, tabs, nav, chips |
| `text-section` | 18 / 24 / 500 | section titles, sentence case (`.section-title`) |
| `text-value` | 20 / 28 / 500 | stat values |
| `text-title` | 24 / 32 / 600 | page title |
| `text-hero` | 36 / 40 / 600 | the connection state on Connect |

The display face (Tomorrow) is for title, section, value, hero and the brand only. Numbers in
tables, stats and amounts use tabular figures (`.num`, `.dtable .n`).

All fonts and flags are **bundled** (`@fontsource*`, `flag-icons`): CSP is `font-src 'self'`, and a
CDN fetch would tell a third party the app is open.

## Layout

**The grid.** One page container for every screen (`.page`: a column centred in the window, 1200 px at most, so the page heading and the content share one column with even margins (leading VPN apps and Windows Settings do the same), set in
`App.tsx`), 32 px gutters (24 px on narrow windows), so left and right edges are the same on
every screen. Spacing is on a 4 px grid: 16 px inside cards and between them, 24 px between
sections, 24 px page top. Controls are 40 px (`.btn`, `.input`, `.chip`, `.toggle-chip`), compact
row actions and tabs 32 px (`.btn-sm`, `.tab`), radius 10 px.

**Building blocks** (`components/ui.tsx`, `styles/index.css`):
- `PageHeader` — title + one sub-line left, page actions right, one row. Every screen has a sub-line.
- `Section` — quiet 18 px title left, its own actions right (`.section-head`), 24 px below.
- `StatStrip` + `StatCell` — 3–4 numbers that belong together in one hairline-split strip, never one card each.
- `.dtable` — header row, 48 px rows, text left, numbers right with the unit in the header; dates via `lib/when.ts` ("Oct 20 · 20:53"); no full stops in cells.
- `Switch` — every on/off setting; a real `<input type=checkbox role=switch>` underneath, so labels, keyboard, tests and `data-*` hooks keep working.
- `.empty-line` — an empty state is one line inside its section, never a card of its own.
- Settings-style screens (Kill switch, Split tunnelling, Settings, Diagnostics) go **two columns
  at 1280 px and wider**: what you set on the left, what it does / live state / checks on the right.

- Left sidebar (brand, 8 screens, status pill, DEVNET badge), main panel right, app-wide banners
  on top of the main panel (RPC warning, low funds, Restore network).
- Onboarding and welcome: split screen, brand story left, steps right (one-shot standard).
- Home: connection card (ring + state + one primary action), then one stat strip, then chips
  (IP · protocol · DNS · country) while connected, then "Recently connected" (favourites + recent, or
  the fastest online) with one-click Connect, so the window is never half empty.
- Servers: search grows, protocol / pricing / sort selects, Online / Favourites / Recent as toggle
  chips; countries with a chevron, flag, `online/total` and the protocol logos that country offers
  (open by default when there are 3 or fewer); server rows are aligned columns under a header
  (server, protocols, price, response, Connect).
- **Protocol marks** (`components/ProtocolMark.tsx`, sources in `docs/ASSETS.md`): wherever a
  protocol is named, its mark goes next to it (WireGuard = name badge only, trademark policy).
  Bundled, never fetched (CSP).
- **One primary per view:** list cards (Plans, Servers) use secondary buttons; the modal or
  sheet they open holds the primary.
- **Settings that restart the service** (kill switch, split, DNS) are a draft + sticky Apply
  bar, never instant toggles; a check that can fail before Apply (DNS servers answering) runs
  live under the control.
- **Honest live state** (Kill switch, Split): the page shows what is happening now (e.g.
  "Blocking internet" + Restore network), measured, never inferred from the saved setting.
- **Money agrees across pages:** the same number has the same name everywhere ("Coming back" on
  Connect and Activity, "Ready to withdraw" in Wallet); counts are hints, amounts are values.
- **Noise folds:** lists put rows that need action first and fold the rest into one line
  (Activity deposits).

## System (UI pass 2026-11)

**Principles.** One screen, one job, one primary action. State is always visible: protected,
not protected and blocked differ by colour, icon and word together. Nothing moves unless you moved
it. Money is said in plain numbers before anything is paid. The app does the work (starts the
service, retries, refunds); the user is asked only for decisions. Advanced detail is one click
away. One accent; colour means state; motion means change.

**Shared parts (`components/`), all shown in every state on the gallery page `#gallery`:**

| Part | Rule |
|---|---|
| `Sheet` | The one dialog shell: same scrim, enter motion, Esc, click outside when idle, focus in and back, scroll lock. `ConfirmModal` and `ConnectSheet` sit on it; a failure is said inside the dialog (`InlineError`). |
| `Banner` + `BannerStack` | Tone = icon + colour. One stack above a page: most serious first, two at most in the shell, one on Connect; a banner opens and closes its own height in 180 ms. |
| `Toasts` (`core/app/notify-rules.ts`) | Title, one line, optional action, close. Same key replaces; three visible, rest folded; errors with an action stay; nothing is shown that the current screen already shows. |
| `SessionCard` (`core/session/status-card.ts`) | One card, one height in every state; used by the sidebar, the phone header and the More list; a click opens Connect. |
| `ApplyBar` | The one sticky apply bar: a note that says what applying costs, Discard, Apply. |
| `RadioCards` | The one radio group: native inputs, a card per choice, a disabled card says why. |
| `RestoreNetworkButton` | The one red button: shows it is working, says a failure next to itself. |
| `Term` (`core/app/help-copy.ts`) | A word with its (?) explanation. One table of explanations for the whole app. |
| `Icon` | One stroked set; no text glyphs as icons. |

**Connect screen (`core/session/connect-stage.ts`).** Stages: Getting ready, Deposit, Connecting,
Checking, Protected, plus Not protected, Reconnecting, Ending and Problem. A status text stays at
least 700 ms (`lib/use-settled.ts`); urgent states (blocked internet, a problem) show at once. The
hero has fixed slots (label, one-line title, two-line detail, one action row); the session's rows
are on the page, empty, from the first stage. The gallery replays every stage on one mounted
screen (`#gallery/connect/<id>`) and the screenshot run fails if anything moves.

**Navigation.** A page opens at its top; Back restores where you were. A filter, a sort or an
open tab is kept with `lib/use-kept.ts`. `go(screen, section)` scrolls to and outlines the part
marked `data-section`. Confirming a connect goes to the Connect screen.

## Copy

**Glossary (enforced on the main screens by `tests/unit/copy-glossary.test.ts`):**

| Say | Never on screen |
|---|---|
| server (the page name **Node test** stays) | node |
| deposit, "on deposit" | lock, escrow, channel, open deposit |
| refund | settle, settlement, rent |
| spending limit | allowance, grant, token permission, spending permission |
| VPN service | daemon, dvpnd |
| this computer / this phone | "device" for the machine |
| plan access | ticket |
| network fees | lamports, rent |
| Solana connection | RPC (only as a field label in Settings, explained) |

- Plain words: "server" not "node" in the app UI; "deposit", "refund", "spending limit".
- Never raw errors on screen; the raw text goes to the log (`link-copy.ts`, `state.ts`).
- Country names from the standard map (`core/nodes/country.ts`): short display names
  (United States, United Kingdom, Hong Kong, DR Congo, Turkey), flags as images.
- Usage and spend say "Approximate · every minute".

## CLI section (standard, from #28b Node Manager)

Every app has a **CLI screen** and a matching command-line tool built from one catalogue
(`src/cli/catalogue.ts`), so the in-app list, `devnet-dvpn help` and `docs/CLI.md` can never
drift (`npm run docs:cli`; a unit test fails if they do).

- Left: commands grouped (Wallet, Device, Daemon, Servers, Connect, Plans, Deposits…), filter
  box, count; each entry can insert, copy or run.
- Right: terminal with history (↑/↓), output kept when switching screens, Clear.
- Commands that spend or change settings need `--yes`, shown in the usage; without it they print
  what would happen and exit 2.
- "Open in PowerShell" defines a `devnet-dvpn` function for that window that runs the app binary
  as Node — nothing is installed or added to PATH.
- Exit codes: 0 ok, 1 failed, 2 needs `--yes`, 3 usage error.

## Checking it

`DVPN_UI_SMOKE=<dir> DVPN_UI_SMOKE_THEME=dark|light DVPN_UI_SMOKE_SIZE=1180x780 electron .` walks
all screens and saves screenshots, `errors.json` (must be `[]`) and `audit.json`. The window runs
off-screen, unfocused and without a taskbar entry or OS notifications, so it never takes over the
owner's screen. `audit.json` comes from `scripts/ui-audit.js`: fonts, the type scale, bold body,
shouty caps, contrast, table alignment, control heights, line length, the 4 px grid, sideways
scroll, page edges and how much of the first view is used. Review both themes after any UI change.
Design pass 2026-10-22: 1140 findings before → 6 (dark, 1180 px) and 3 (light, 1440 px) after; what
is left is long error text and a short Plans list at 1440 px.

**Marks and flags** (owner review 2026-10-22: "logos are not big enough"). Country flags are
4:3 with a hairline outline: 24 × 18 px in lists, 44 px tall in the connect ring, 14 px inside a
button. Protocol logos: 20 px in lists and tags, 24 px standalone; WireGuard's name badge reads
"WG". App mark 40 px. The connect card is one centred stack (ring, state, one line, actions), the
way leading VPN apps lay out their connect view. Empty sections show one dashed line
(`.empty-box`), not an empty card. A disabled primary button is flat neutral, not a faded gradient.
