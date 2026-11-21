# AGENT-COMMANDS.md: claim → code trace (internal)

Every statement in `docs/AGENT-COMMANDS.md` about what `agent status` / `agent up` / `agent down`
spend, sign, print or exit with, tied to the line it rests on. Line numbers are at the Windows app 8f37a8d (the A5 commit after it adds 9 lines to `down` at :185; lines below that in `down` move by +9)
(`src/cli/agent-cmd.ts` unless another file is named). **UNTIED** = no line in this repo proves it
(it rests on the service, the chain program or another session's code); **WRONG** = the doc says more
than the code does. Not for the hub's public list.

## Exit codes and line shapes

| Claim | Line |
|---|---|
| exit 0 after a command returns | `src/cli/index.ts:91-92` |
| exit 2 = needs `--yes`, nothing signed | `index.ts:94` (NeedsConfirm → 2); `src/cli/commands.ts:60-64` (confirm prints `{needsConfirm, what, ...data}` then throws) |
| exit 3 = usage, no JSON, one stderr line, nothing ran | `index.ts:96` (UsageError → stderr, 3); unknown flag `index.ts:≈70-74`; unknown subcommand `:240` |
| exit 1 line `{ok:false,error,code,action}` | `index.ts:109` (JSON) and its `return 1` |
| `action` is the next step from agent-cmd | `:38-39` fail() sets `{code, action}` |
| …unless index.ts rewrites a service / RPC error | `index.ts:≈88-104` (`daemonErrorCopy`, `rpcUnavailableCopy`); codes in `src/core/daemon/link-copy.ts:29-51` |
| one JSON line per run on stdout | `index.ts` `out.print` (writes `data` once per `o.print`); each command calls `o.print` once on success (`:127` / `:167`, `:199`, `:232`) |
| rival-VPN warning goes to stderr | `:162-163` |
| amounts are decimal strings | `tdvpn()` / `sol()` at `:152`, `:198`, `:227-229`; `baseUnits` = `c.escrow` string `:152` |

## agent status

| Claim | Line |
|---|---|
| reads only, never signs, never connects, never asks for `--yes` | `:216-233`: refreshWallet, adoptRunningSession `{watch:false}`, daemonInfo, exitIp; no confirm, no connect |
| fields `ok,address,sol,tdvpn,refundable,device,service,connected,next` | `:227-230` |
| `sol`/`tdvpn`/`refundable` null when no wallet or unreadable | `:218` (no owner → null), `within` returns undefined on timeout (`src/cli/status-cmd.ts:59-67`), `:227-228` |
| `refundable` = tDVPN held in the program for this wallet | `:228` reads `wallet.userBalance`. **UNTIED** here: the meaning rests on `src/core/app/wallet-status.ts` |
| `device` null = not set up; `service` = the service answers | `:228` `d.device`, `d.reachable` |
| `session,node,protocol,spent,exitIp,socks` only when connected | `:229` (spread only when `live`) |
| `exitIp` null if the check did not finish within 8 s | `:34`, `:106-110` (within + sid match) |
| `socks` null on Android or when the protocol gives none | `:229` (`proxyEndpoint && !isAndroid()`) |
| `next` order: no wallet → connected → unreadable → short of SOL/tDVPN → service missing → up | `:204-213` (`statusNext`); SOL threshold `AGENT_SOL_MIN` `:36`, `:209` |

## agent up

| Claim | Line |
|---|---|
| bad flag values are exit 3 before anything runs | `:63-76` (agentInputs) is the first call in `up` (`:115`) |
| `--units` 1–1000, default from settings | `:66`, `:115` |
| `--basis` defaults to the saved setting | `:64`, `:115` |
| `--max-price` per unit of the basis | `:81` (price by basis) |
| `--protocol` prefers single-protocol servers | `:86-87` |
| the protocol really used is reported | `:94` `protocol: live.service`. **UNTIED**: "the service picks on a multi-protocol server" rests on dvpnd; `connect()` has no protocol field |
| no wallet → `no-wallet` before anything else | `:116-117` |
| a matching live session is answered, `reused:true`, `deposit:null`, nothing paid, no `--yes` | `:119-128` (before confirm `:159`); `null` deposit `:126` |
| on its own: reads session, servers (probing), wallet, subscriptions | `:119`, `:146`, `:141-144` |
| creates the device key without `--yes` (local, no transaction) | `:133-137` before confirm `:159`; pinned by agent-cmd.test.ts "no device key, WITHOUT --yes" |
| never without `--yes`: deposit, approval, connect, switch | confirm `:159` precedes connect `:164`, the only spending call |
| exit-2 fields `what,node,deposit,switchFrom`; switch says `Switch from` | `:159-161` |
| a mismatching session is switched; the live server is never picked | `:148` (excluded), `:164` (`switch: true`) |
| with the kill switch on, the block stays up between the two | `src/main/services/connection.ts:551-554` (`keepKillSwitch` on the switch's disconnect). **UNTIED** in part: the block itself is kept by dvpnd final6.14 (Q0557) |
| `no-nodes` / `not-funded` mean no transaction ran | `:150`, `:153-157`, both before `:164` |
| success fields | `:91-100` (`upAnswer`) + `reused` `:126` |
| `deposit` shapes `{basis,units,tdvpn,baseUnits}` / `{plan,tdvpn:"0"}` | `:152` |
| "`tdvpn` = most it can hold; the unused part is refunded" | `:151` costPreview escrow. **UNTIED**: the refund rests on the chain program and settlement |
| `directIp` = this computer's own address | `:95` (`homeIp`, or the proxy check's `directIp`) |
| `next` with / without socks | `:96-99` |
| failure `action` = `nextFor(code)` | `:165`, `:43-58` |
| Windows vs Linux/macOS elevation text | `:46-49` |
| "a failed connect after a deposit was paid leaves it open: `agent down --yes` closes it" | **UNTIED**: rests on connection.ts / settlement.ts behaviour, not on a line here |

## agent down

| Claim | Line |
|---|---|
| on its own: reads the session and the deposits | `:172-181` |
| never without `--yes`: the disconnect or any transaction | confirm `:183-184` precedes disconnect `:186` and settle `:188` |
| exit-2 fields `what,session,perHour,perGb` | `:183-184` |
| counts open + ready + the live session's own `in-use` deposit | `:180-182`; `in-use` = `src/main/services/settlement.ts:86`, `:94` |
| `--yes`: disconnect then one settle run | `:186`, `:188` |
| disconnect puts back the system proxy; ending a live session releases the block; a session already gone + kill switch on keeps it until restore-network | `src/cli/commands.ts:298-306` (`:302-303` = session already gone); live-session release = `src/core/daemon/config.ts:252-255` comment ("session.go: a user disconnect releases both"), dvpnd behaviour, **UNTIED** here and not proven live on desktop. 9ba4299 said it always releases; 1203219 says persist always keeps it, which the config.ts comment contradicts for a live session. K6 (review's final words, 7fcf543 + next): a dropped session keeps the block (Windows RC1 x64 + arm64); check `quality ip`, then `restore-network` (for now) + `set --kill-switch off` (for good). A live desktop disconnect releasing it: not proven (Android only) |
| per-hour closed at once; per-GB starts its 2-hour close | `:188` runSettlement. **UNTIED** here: the close rules live in settlement.ts (7200 s, `:32`) and the program |
| `busy` → failure, action `settle run --yes` | `:190` (lock `settlement.ts:25`, `:148`) |
| other settle failure → code or `settle-failed`, action `settle list` | `:191` |
| success fields `ok,disconnected,spent,refundable,readyAt,signatures,pending,next` | `:198` |
| `signatures` = transactions this run signed | `:192` (`runSettlement` data) |
| `readyAt` = latest time a closing deposit can be finished | `:195` |
| `pending` = deposits left, with `status` values | `:193`; shape `src/shared/types.ts:89-96` |
| `next` three cases | `:196-197` |

## UNTIED claims: live evidence

Linux walk 2026-11-15, hub `tests/walk/evidence/linux-20261115/steps/` (rc2 runtime, devnet, node E5o54j…).

| Claim | Live evidence | State |
|---|---|---|
| the unused part of a deposit is refunded | phase c: `05-wallet-show` ownerTdvpn 20000000 → deposit D7bhwB8a escrow 2000 (`15-settle-list`, redeemed 0→1) → `16-settle-run` (start close) → `17-settle-list` closing → `16-settle-run-c1` (close) → `17-settle-list-c1` `[]` → `19-wallet-show` ownerTdvpn 19999999: 1999 of 2000 back, 1 used. Went straight to the wallet's tDVPN (`17-withdraw` signature null, userBalance 0) | **PROVEN** (per-GB) |
| a per-GB deposit takes 2 h to close | `38-s7-down` readyAt 1794761963 = its start-close + 7200 s (`44-wallet-show` at 1794754783 s); `42`/`89-settle-list` still `closing` at that readyAt; phase c's D7bhwB8a closed after its wait (`16-settle-run-c1`, `17-settle-list-c1`) | **PROVEN** |
| status `refundable` = program balance (userBalance) | `30-s1-status` / `39-s8-status` `"0"` = `05`/`44-wallet-show` userBalance 0. Never non-zero on devnet (refunds go to the wallet), so only the zero case is seen | PARTLY (zero case only) |
| down `refundable` = sum over pending | `38-s7-down` 0.001883 = `42-settle-list` refundable 1883. It is a lower bound: phase c listed 1883 and 1999 came back | **PROVEN** + doc says "lower bound" |
| a per-hour deposit is closed at once by `agent down --yes` | Linux c3 (17:02Z visit, the Linux app 3c6a3fd7 bundle, per-hour on E5o54j): `65-h4-down-preview` exit 2, perHour ≥ 1 for the live in-use deposit (S6 fix re-proven); `66-h5-down` exit 0, ≥ 1 signature; `67` channel closed at once; `68` refund back, ownerTdvpn + userBalance 8999 → 11981 base units (step files with review's pull) | **PROVEN** |
| the service picks the protocol on a multi-protocol server | none: E5o54j offers one protocol | UNPROVEN: no test, no live step in the Windows app |
| the kill-switch block is kept across a switch | not in this walk; Q0557 was proven on Windows rc2 r91/r92 under the app's switch, not through `agent up` (the Windows app handoff STATE, "Q0557 PROVING") | UNPROVEN through `agent up` |
| a paid-then-failed connect's deposit is closed by `agent down --yes` | agent-cmd.test.ts "a connect that failed after paying" proves the closing with an injected open deposit; that connect() leaves it open is not tested; no live step | PARTLY (unit only) |

## Open items from this trace

1. **WRONG, fixed in the same commit:** AGENT-COMMANDS.md said disconnect releases the kill switch; with
   `persist` it keeps the block (`commands.ts:302-303`). The doc now says so.
2. **UNTIED, rest on other code:** `refundable` meaning, protocol choice on multi-protocol servers, kill-switch
   block kept across a switch, refund of the unused deposit, the per-hour / per-GB close rules, a paid-then-failed
   connect's deposit. Each needs a test in the owning lane or a live step to prove it.
