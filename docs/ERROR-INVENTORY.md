# Error inventory (generated — `node scripts/error-inventory.mjs`)

Every user-facing error, warning and refusal string in `src/`, found by pattern (thrown errors,
Result `error:`, `fail()`, toasts, Banners, copy tables). Input to E3 (`ERROR-STANDARDS.md`);
do not edit by hand, re-run the script.

Total 412: throw 168, fail 16, return 27, copy 80, result 90, toast 19, banner 12

| Where | Kind | Text | Action |
|---|---|---|---|
| `src/cli/agent-cmd.ts:67` | throw | --basis must be per_gb or per_hour |  |
| `src/cli/agent-cmd.ts:70` | throw | --protocol must be any, ${PROTOCOLS.join(', ')} |  |
| `src/cli/agent-cmd.ts:72` | throw | --country must be a two-letter country code, e.g. DE |  |
| `src/cli/agent-cmd.ts:76` | throw | --max-price: ${(err as Error).message} |  |
| `src/cli/agent-cmd.ts:119` | fail | No wallet. |  |
| `src/cli/agent-cmd.ts:144` | fail | You do not hold an active subscription ${inp.plan}. |  |
| `src/cli/agent-cmd.ts:159` | fail | Not enough funds for this deposit (${tdvpn(c.escrow)} tDVPN). |  |
| `src/cli/agent-cmd.ts:199` | fail | Could not disconnect, so no deposit was closed (a per-hour deposit keeps billing). ${reason} |  |
| `src/cli/agent-cmd.ts:205` | fail | Disconnected, but another refund run was busy, so the deposits were not closed. |  |
| `src/cli/agent-cmd.ts:255` | throw | unknown: agent ${sub} (up \| down \| status) |  |
| `src/cli/android/split-android-cmd.ts:29` | throw | split routes all\|include\|exclude [address\|network…] |  |
| `src/cli/android/split-android-cmd.ts:40` | throw | unknown: split ${sub} |  |
| `src/cli/android/split-android-cmd.ts:42` | throw | split set all\|include\|exclude [package…] |  |
| `src/cli/args.ts:37` | throw | --${name} must be a whole number from ${min} to ${max} |  |
| `src/cli/commands.ts:70` | throw | --basis must be per_gb or per_hour |  |
| `src/cli/commands.ts:78` | throw | No wallet. Run "wallet create" or "wallet import <file>". |  |
| `src/cli/commands.ts:79` | throw | Could not read the balances of ${ownerAddress()} right now (network or RPC busy). Try again in a moment. |  |
| `src/cli/commands.ts:103` | throw | wallet import <keyfile.json \| -> (- reads stdin) |  |
| `src/cli/commands.ts:108` | throw | no wallet |  |
| `src/cli/commands.ts:118` | throw | wallet send --to <address> [--tdvpn N] [--sol N] --yes |  |
| `src/cli/commands.ts:120` | throw | "${to}" is not a Solana wallet address. |  |
| `src/cli/commands.ts:121` | throw | --${k} must be a positive number |  |
| `src/cli/commands.ts:122` | throw | Give --tdvpn N and/or --sol N. |  |
| `src/cli/commands.ts:128` | throw | unknown: wallet ${sub} |  |
| `src/cli/commands.ts:141` | throw | device register [device-pubkey] [--home <dir>] (wallet required) |  |
| `src/cli/commands.ts:152` | throw | ${isAndroid() ? 'This phone' : 'This computer'} has no device key yet. Create it first with: devnet-dvpn daemon init. Then run device setup again. |  |
| `src/cli/commands.ts:180` | throw | no device recorded |  |
| `src/cli/commands.ts:185` | throw | unknown: device ${sub} |  |
| `src/cli/commands.ts:203` | throw | nodes ${sub} <node> |  |
| `src/cli/commands.ts:205` | throw | No such node. |  |
| `src/cli/commands.ts:210` | throw | nodes fav <node> |  |
| `src/cli/commands.ts:220` | throw | unknown: nodes ${sub} |  |
| `src/cli/commands.ts:226` | throw | cost <node> [--basis per_gb\|per_hour] [--units N] |  |
| `src/cli/commands.ts:234` | throw | connect <node> [--basis] [--units N] [--plan <subscription>] --yes |  |
| `src/cli/commands.ts:248` | throw | You do not hold that subscription. |  |
| `src/cli/commands.ts:253` | throw | No such node. |  |
| `src/cli/commands.ts:264` | throw | ${(err as Error).message}\n-> Another VPN (${rivals.join(', ')}) is on and is probably blocking this: turn it off, then connect again. |  |
| `src/cli/commands.ts:327` | throw | channels fund <channel> --tdvpn N --yes |  |
| `src/cli/commands.ts:350` | throw | plans roster <plan> |  |
| `src/cli/commands.ts:352` | throw | No plan ${a._[2]} on devnet. Run "plans list" to see the plans. |  |
| `src/cli/commands.ts:368` | throw | plans subscribe <plan> --yes |  |
| `src/cli/commands.ts:378` | throw | plans close <subscription> --yes |  |
| `src/cli/commands.ts:383` | throw | unknown: plans ${sub} |  |
| `src/cli/commands.ts:408` | throw | unknown: settle ${sub} |  |
| `src/cli/daemon-cmd.ts:77` | throw | create or import a wallet first |  |
| `src/cli/daemon-cmd.ts:87` | throw | Upgrade of the VPN service home stopped at "${r.step}": ${r.error}\n${r.log.join('\n')} |  |
| `src/cli/daemon-cmd.ts:91` | throw | Create or import a wallet, then run "device setup --yes": the service will not start without a funded, permitted device. |  |
| `src/cli/daemon-cmd.ts:101` | throw | Run "device setup --yes" first: the service will not start without a funded, permitted device. |  |
| `src/cli/daemon-cmd.ts:138` | throw | --${k} is for the desktop app; on Android use: split set / split routes |  |
| `src/cli/daemon-cmd.ts:148` | throw | unknown DNS preset "${dns}": use ${Object.keys(DNS_PRESETS).join(', ')} or IP addresses |  |
| `src/cli/daemon-cmd.ts:172` | throw | --split-apps: separate apps with ";", not commas (for example "<app 1>;<app 2>"). |  |
| `src/cli/daemon-cmd.ts:214` | throw | unknown DNS preset "${dns}": use ${Object.keys(DNS_PRESETS).join(', ')} or IP addresses |  |
| `src/cli/daemon-cmd.ts:230` | throw | unknown: daemon ${sub} |  |
| `src/cli/info-cmd.ts:48` | throw | Third-party checks are turned off in settings. |  |
| `src/cli/info-cmd.ts:69` | throw | rpc set <url> [url...] |  |
| `src/cli/info-cmd.ts:71` | throw | Not accepted (https only; http only for 127.0.0.1): ${bad.map(redactUrls).join(', ')} |  |
| `src/cli/info-cmd.ts:89` | throw | settings set key=value ... |  |
| `src/cli/info-cmd.ts:92` | throw | unknown setting "${k}". Known: ${Object.keys(DEFAULT_SETTINGS).join(', ')} |  |
| `src/cli/info-cmd.ts:99` | throw | The value for ${rejected.join(', ')} is not allowed, so it was left unchanged. |  |
| `src/cli/info-cmd.ts:116` | throw | unknown: settings ${a._[1]} |  |
| `src/cli/info-cmd.ts:139` | throw | --browser must be ${BROWSERS.join(' or ')} |  |
| `src/cli/info-cmd.ts:142` | throw | The current session has no SOCKS endpoint (only V2Ray/Xray sessions do). Nothing was opened. |  |
| `src/cli/info-cmd.ts:148` | throw | unknown: proxy ${sub} |  |
| `src/cli/info-cmd.ts:151` | throw | The current session has no SOCKS endpoint (only V2Ray/Xray sessions do). Nothing was changed. |  |
| `src/cli/keystore.ts:24` | throw | Windows cannot encrypt a wallet for this logon (no password session, e.g. an SSH key login). Use a key file instead: --keyfile <path> or DVPN_KEYFILE. |  |
| `src/cli/keystore.ts:26` | throw | Windows wallet encryption failed: ${(err as Error).message.split('\n')[0]} |  |
| `src/cli/keystore.ts:36` | throw | A --keyfile wallet is read-only. Unset DVPN_KEYFILE to import or create a wallet. |  |
| `src/cli/keystore.ts:37` | throw | A --keyfile wallet is never deleted by this CLI. |  |
| `src/cli/poll-cmd.ts:22` | throw | unknown job "${s}". Jobs: ${POLL_JOB_NAMES.join(', ')} |  |
| `src/cli/poll-cmd.ts:34` | throw | poll set <job>=<seconds> … |  |
| `src/cli/poll-cmd.ts:40` | throw | ${job} must be a whole number of seconds from ${POLL_JOBS[job].min} to ${POLL_JOBS[job].max} |  |
| `src/cli/poll-cmd.ts:56` | throw | ${runs.filter((r) => !r.ok).map((r) => r.name).join(', ')} failed. |  |
| `src/cli/poll-cmd.ts:78` | throw | a job broke its cadence |  |
| `src/cli/poll-cmd.ts:79` | throw | unknown: poll ${sub} |  |
| `src/cli/split-cmd.ts:57` | throw | split status \| apps [--search TEXT] |  |
| `src/cli/test-cmd.ts:32` | throw | test run <server…> \| --online [--country C] [--protocol P] [--failed-last] [--never-tested] \| --resume |  |
| `src/cli/test-cmd.ts:87` | throw | No server matches that choice. |  |
| `src/cli/test-cmd.ts:147` | throw | unknown: test ${sub} |  |
| `src/core/app/device-setup.ts:140` | return | Add devnet SOL to your wallet first: setting up this computer to pay nodes needs about ${(needLamports / 1e9).toFixed(3)} SOL for fees. |  |
| `src/core/app/device-setup.ts:159` | throw | Disconnect first: this computer is using a deposit right now. Deposits are still refunded to your wallet after you remove the device. |  |
| `src/core/app/device-setup.ts:161` | throw | This device has no spending permission to remove. |  |
| `src/core/app/wallet-status.ts:73` | copy | The device is low on SOL for fees. Top it up in Wallet. |  |
| `src/core/app/wallet-status.ts:74` | copy | Your wallet has under 1 tDVPN. Deposits will fail until you add more. |  |
| `src/core/app/wallet-status.ts:75` | copy | The device spending limit is almost used up. Raise it in Wallet. |  |
| `src/core/chain/amounts.ts:27` | throw | "${amount}" is not a tDVPN amount. Use a number like 2.5. |  |
| `src/core/chain/amounts.ts:29` | throw | A tDVPN amount has at most ${TOKEN_DECIMALS} decimals; "${amount}" has more. |  |
| `src/core/chain/amounts.ts:31` | throw | The tDVPN amount "${amount}" is too large. |  |
| `src/core/chain/amounts.ts:38` | throw | "${amount}" is not a SOL amount. Use a number like 0.05. |  |
| `src/core/chain/amounts.ts:40` | throw | SOL has 9 decimals, got "${amount}" |  |
| `src/core/chain/builders.ts:158` | throw | fund_channels: duplicate channel |  |
| `src/core/chain/errors.ts:94` | return | This would leave an account below Solana's minimum balance (about 0.001 SOL). Send a little less. |  |
| `src/core/chain/errors.ts:102` | return | A tDVPN token account this transaction needs does not exist yet. |  |
| `src/core/chain/idl.ts:70` | throw | IDL has no account ${pascal} |  |
| `src/core/chain/program.ts:41` | throw | id must be 32 bytes, got ${buf.length} |  |
| `src/core/chain/program.ts:91` | throw | Config account ${addr.toBase58()} not found on ${PROGRAM_ID.toBase58()} |  |
| `src/core/chain/tx.ts:58` | throw | ${label}: no instructions |  |
| `src/core/chain/tx.ts:115` | copy | Transaction ${signature} failed. |  |
| `src/core/chain/tx.ts:120` | throw | ${label}: transaction ${signature} expired before confirmation. |  |
| `src/core/chain/tx.ts:130` | throw | ${label}: sent but not confirmed within ${CONFIRM_TIMEOUT_MS / 1000}s (signature ${signature}); it may still land, so check again before retrying${lastReadError ? |  |
| `src/core/chain/tx.ts:145` | throw | Signed transaction fee payer does not match your wallet. |  |
| `src/core/chain/tx.ts:148` | throw | Transaction calls a program the app does not accept: ${pid ? pid.toBase58() : '?'} |  |
| `src/core/chain/tx.ts:150` | throw | Address lookup tables are not accepted. |  |
| `src/core/daemon/config.ts:77` | throw | value contains a quote or newline: ${JSON.stringify(s)} |  |
| `src/core/daemon/config.ts:180` | throw | Kill switch must be off, on or persist. |  |
| `src/core/daemon/config.ts:181` | throw | Basis must be per_gb or per_hour. |  |
| `src/core/daemon/config.ts:182` | throw | Whole device must be true or false. |  |
| `src/core/daemon/config.ts:183` | throw | DNS mode must be one of ${DNS_MODES.join(', ')} |  |
| `src/core/daemon/config.ts:184` | throw | DNS needs 1 to 4 servers. |  |
| `src/core/daemon/config.ts:185` | throw | ${d} is not an IP address. |  |
| `src/core/daemon/config.ts:188` | throw | The deposit must be a positive whole number. |  |
| `src/core/daemon/config.ts:190` | throw | ${k} must be a whole number (0 = the node's minimum) |  |
| `src/core/daemon/config.ts:202` | throw | ${k} has characters a URL cannot hold (spaces, quotes, backslashes) |  |
| `src/core/daemon/config.ts:207` | throw | ${k} is not a URL: ${(err as Error).message} |  |
| `src/core/daemon/config.ts:210` | throw | ${k} must use ${okProtos.join(' or ')}//. |  |
| `src/core/daemon/config.ts:211` | throw | ${k} needs a real host name, got "${u.hostname}" |  |
| `src/core/daemon/config.ts:220` | throw | Split mode must be off, include or exclude. |  |
| `src/core/daemon/config.ts:221` | throw | Split apps and routes must be lists. |  |
| `src/core/daemon/config.ts:222` | throw | Too many split apps or routes (64 apps, 256 routes). |  |
| `src/core/daemon/config.ts:224` | throw | Split app path contains a quote or newline: ${JSON.stringify(a)} |  |
| `src/core/daemon/config.ts:226` | throw | Split app must be a full path: ${a} |  |
| `src/core/daemon/config.ts:227` | throw | Split app must be an .exe file: ${a} |  |
| `src/core/daemon/config.ts:231` | throw | Split app must be an app's own program, like /Applications/Name.app/Contents/MacOS/Name (pick it from the app list): ${a} |  |
| `src/core/daemon/config.ts:236` | throw | Split route must be an IP address or range like 10.0.0.0/8, not a name (sites behind a CDN change addresses): ${r} |  |
| `src/core/daemon/config.ts:237` | throw | Split include/exclude needs at least one app or route. |  |
| `src/core/daemon/flags.ts:8` | throw | --escrow must be a positive tDVPN amount, e.g. 2.5 |  |
| `src/core/daemon/flags.ts:14` | throw | --${name} must be a whole number (0 = the node's minimum) |  |
| `src/core/daemon/flags.ts:23` | throw | --${name} must be true or false, got "${raw}" |  |
| `src/core/daemon/layout.ts:61` | throw | not an instance tag: ${tag} |  |
| `src/core/daemon/link-copy.ts:33` | copy | This wallet's spending approval for this computer was revoked, so nothing was paid. Set it up again (device setup) from your wallet. | devnet-dvpn device setup --yes |
| `src/core/daemon/link-copy.ts:36` | copy | Your wallet doesn't have enough tDVPN for this deposit, so nothing was paid. Add tDVPN or pick a smaller deposit. | devnet-dvpn disconnect |
| `src/core/daemon/link-copy.ts:39` | copy | A session is already active; disconnect it first. | devnet-dvpn agent status --json |
| `src/core/daemon/link-copy.ts:45` | copy | The VPN service is starting up or stopping. Try again in a moment. |  |
| `src/core/daemon/link-copy.ts:48` | copy | The VPN service is not running. |  |
| `src/core/nodes/nodeapi.ts:21` | throw | domain ${tag} exceeds 32 bytes |  |
| `src/core/nodetest/stages.ts:103` | return | Nothing was paid. |  |
| `src/core/nodetest/stages.ts:104` | return | The deposit was closed and the unused part is back in your wallet. |  |
| `src/core/nodetest/stages.ts:105` | return | The refund of the unused deposit has started and takes about 2 hours. |  |
| `src/core/nodetest/stages.ts:106` | return | The deposit is still open. The app will close it. |  |
| `src/core/pricing/cost.ts:53` | return | Not enough tDVPN: this deposit needs ${tdvpn(p.escrow)}. |  |
| `src/core/pricing/cost.ts:55` | return | Your spending approval is lower than this deposit. Raise it in Wallet → Device. |  |
| `src/core/pricing/cost.ts:56` | return | This device's spending limit is lower than this deposit. Raise it in Wallet → Device. |  |
| `src/core/pricing/cost.ts:58` | return | This device needs a little SOL (0.005) for network fees and the deposit account. Top it up in Wallet → Device. |  |
| `src/core/quality/quality.ts:56` | throw | No tunnel to measure through right now (reconnecting) |  |
| `src/core/quality/quality.ts:148` | result | No IP service answered (${errors.join('; ')}) |  |
| `src/core/quality/quality.ts:176` | throw | Left out of the VPN by split tunnelling. |  |
| `src/core/quality/quality.ts:197` | result | Speed test failed (${errors.join('; ')}) |  |
| `src/core/quality/socks.ts:21` | fail | SOCKS ${endpoint}: no answer within ${timeoutMs} ms. |  |
| `src/core/quality/socks.ts:26` | fail | SOCKS ${endpoint}: not a no-auth SOCKS5 proxy. |  |
| `src/core/quality/socks.ts:34` | fail | SOCKS ${endpoint}: could not reach ${host}:${port} (reply ${buf[1]}) |  |
| `src/core/quality/socks.ts:36` | fail | SOCKS ${endpoint}: bad reply address type ${buf[3]} |  |
| `src/core/quality/socks.ts:45` | fail | SOCKS ${endpoint}: ${err.message} |  |
| `src/core/session/setup-gate.ts:28` | return | This device needs a little SOL for transaction fees (has ${sol(lamports)}, needs ${sol(DEVICE_MIN_LAMPORTS)}). |  |
| `src/core/session/state.ts:103` | copy | Disconnected. | Add funds and reconnect |
| `src/core/session/state.ts:104` | copy | Your deposit ran out. | Add funds and reconnect |
| `src/core/session/state.ts:106` | copy | The connection to this server stopped working. | Pick another server |
| `src/core/session/state.ts:109` | copy | Connected to the server, but no traffic gets through it. Try another server or protocol. | Pick another server |
| `src/core/session/state.ts:110` | copy | This network drops large packets, so this server's tunnel can't carry traffic. A server with V2Ray or Xray usually works. | Try another protocol |
| `src/core/session/state.ts:111` | copy | Connection to the server was lost. | Reconnect |
| `src/core/session/state.ts:112` | copy | The server ended the session. | Pick another server |
| `src/core/session/state.ts:113` | copy | The payment channel was closed. | Reconnect with a new deposit |
| `src/core/session/state.ts:114` | copy | Your deposit is being refunded, so the session ended. | Connect with a new deposit |
| `src/core/session/state.ts:115` | copy | Your deposit was refunded, so the session ended. | View plans |
| `src/core/session/state.ts:116` | copy | Disconnected. | View plans |
| `src/core/session/state.ts:118` | copy | You've used this plan's data. | View plans |
| `src/core/session/state.ts:119` | copy | Your plan access expired. Connect again to renew it. | Reconnect |
| `src/core/session/state.ts:120` | copy | This server is no longer on your plan right now. | Pick another server |
| `src/core/session/state.ts:121` | copy | This session was replaced by a newer one. |  |
| `src/core/session/state.ts:124` | copy | The connection to this server is losing data, so the app stopped paying for data this device did not receive. | Pick another server |
| `src/core/session/state.ts:125` | copy | The server counted more data than this device did, so the app stopped paying it. | Pick another server |
| `src/core/session/state.ts:126` | copy | The tunnel stopped responding, so the session ended. Your unused deposit is refunded automatically. | Reconnect |
| `src/core/session/state.ts:128` | copy | The VPN service restarted with your new settings, so the session ended. | Reconnect |
| `src/core/session/state.ts:129` | copy | The VPN service restarted. | Reconnect |
| `src/core/session/state.ts:131` | copy | The VPN service stopped and has not started again. | Restore network |
| `src/core/session/state.ts:134` | copy | The VPN service restarted, so the session ended. | Reconnect |
| `src/core/session/state.ts:144` | copy | Not enough credit left on this plan or deposit. | Add funds |
| `src/core/session/state.ts:145` | copy | Your plan allows a limited number of devices at once, or the server is full. Disconnect one first. | Pick another server |
| `src/core/session/state.ts:146` | copy | This server isn't available on your plan right now. | Pick another server |
| `src/core/session/state.ts:147` | copy | Your plan doesn't include this server, or it expired. | Pick another server |
| `src/core/session/state.ts:151` | copy | This device's clock is wrong by more than a minute, so the plan provider refused the request. Set the date and time to automatic, then connect again. Nothing was paid. | Fix the clock |
| `src/core/session/state.ts:153` | copy | The plan's provider is not answering, so this server can't check your plan. Nothing was paid. | Retry later |
| `src/core/session/state.ts:156` | copy | Your plan couldn't give this server access. Its data may already be shared out to the servers you use, or the plan provider is not answering. | Pick a server you already use |
| `src/core/session/state.ts:157` | copy | This device is not allowed to spend for your wallet yet. | Set up device |
| `src/core/session/state.ts:158` | copy | Deposit too small for this server's minimum. | Increase deposit |
| `src/core/session/state.ts:159` | copy | Deposit too small for this server's minimum. | Increase deposit |
| `src/core/session/state.ts:160` | copy | The server restarted since your deposit was made. | Reconnect with a new deposit |
| `src/core/session/state.ts:161` | copy | The server refused the payment terms. | Pick another server |
| `src/core/session/state.ts:162` | copy | The server is busy. | Retry later |
| `src/core/session/state.ts:163` | copy | The app could not sign the payment. Send a problem report from Diagnostics. | Report |
| `src/core/session/state.ts:164` | copy | The server expects a different payment mode. Send a problem report from Diagnostics. | Report |
| `src/core/session/state.ts:165` | copy | The server expects a different payment mode. Send a problem report from Diagnostics. | Report |
| `src/core/session/state.ts:189` | copy | Connecting stopped because you disconnected. If a deposit was already sent, its unused part is refunded automatically. | Connect again |
| `src/core/session/state.ts:192` | copy | Waiting for the network. The VPN service started before this device was online and is still trying to reach the Solana network. Nothing was paid. | Retry in a moment |
| `src/core/session/state.ts:195` | copy | A VPN session is already running (started from the command line or another window). Disconnect it first, then connect again. Nothing was paid. | Disconnect |
| `src/core/session/state.ts:198` | copy | This plan access belongs to another wallet than the one this computer's VPN service uses. Switch back to that wallet, or set up this computer again with the current wallet. Nothing was paid. | Set up device |
| `src/core/session/state.ts:208` | copy | The connection to the previous server is still closing, so nothing was paid. Connect again in a few seconds. | Retry |
| `src/core/session/state.ts:210` | copy | The VPN service stopped while connecting. If the kill switch is on, it is still blocking the internet: connect again, or press Restore network. | Retry |
| `src/core/session/state.ts:211` | copy | The kill switch is still blocking the internet and lets through only the server you were on, so this server cannot be reached. Press Restore network, then connect. Nothing was paid. | Restore network |
| `src/core/session/state.ts:215` | copy | Another program on this computer is using ${busy[1] ? | Try another protocol |
| `src/core/session/state.ts:218` | copy | The VPN couldn't change this computer's DNS settings (often a container or a locked /etc/resolv.conf). In Settings, turn off Use the VPN's DNS, then connect again. Your unused deposit is refunded automatically. | Open settings |
| `src/core/session/state.ts:223` | copy | This server's protocol isn't installed on this computer. | Pick another server |
| `src/core/session/state.ts:227` | copy | This server failed its identity check: its signed details don't match its listing. It may run an older version. Nothing was paid. | Pick another server |
| `src/core/session/state.ts:232` | copy | This server billed more than this device measured, so the app won't pay it again from this deposit. Nothing more was paid. Pick another server; what is left of this deposit is refunded automatically. | Pick another server |
| `src/core/session/state.ts:233` | copy | This server's price changed since you paid the deposit. Nothing more was paid. Pick another server, or refund it and reconnect at the new price. | Pick another server |
| `src/core/session/state.ts:234` | copy | The VPN service could not turn on the kill switch for this connection, so it stopped. Try again, or turn the kill switch off in Settings. | Retry |
| `src/core/session/state.ts:237` | copy | Hysteria2 couldn't reach this server. The server may be down, or this network may block UDP or allow only small packets; a server with another protocol usually works. Your unused deposit is refunded automatically. | Try another protocol |
| `src/core/session/state.ts:240` | copy | This network drops large packets, so this server's tunnel can't carry traffic. A server with V2Ray or Xray usually works. Your unused deposit is refunded automatically. | Try another protocol |
| `src/core/session/state.ts:241` | copy | The tunnel came up but no traffic passes through it. The server may be misconfigured, or this network may block it. Your unused deposit is refunded automatically. | Try another server or protocol |
| `src/core/session/state.ts:246` | copy | The VPN service on this computer could not start the program this server's protocol needs (${tool[2] ?? tool[1]}). Your deposit with this server is kept and is used the next time you connect to it. Open Diagnostics and repair the VPN service, or pick a server with another protocol. | Open diagnostics |
| `src/core/session/state.ts:247` | copy | The server accepted the deposit but the tunnel didn't come up. The server may be down, or your network may block this protocol (WireGuard, AmneziaWG and Hysteria2 need UDP). Your unused deposit is refunded automatically. | Try another server or protocol |
| `src/core/session/state.ts:250` | copy | This deposit is larger than this computer's spending limit allows. Raise the limit in Wallet, then connect again. Nothing was paid. | Open Wallet |
| `src/core/session/state.ts:251` | copy | This device is out of SOL for network fees. | Top up device |
| `src/core/session/state.ts:254` | copy | Your deposit with this server is still being confirmed by the network. Try again in a few minutes; you will not pay twice. Or pick another server now. | Pick another server |
| `src/core/session/state.ts:258` | copy | This network intercepted the connection to the Solana network (a login page, proxy or filter). Nothing was paid. Try another network, or set your own RPC endpoint in Settings. | Retry |
| `src/core/session/state.ts:260` | copy | This server isn't answering right now, so nothing was paid. Pick another server, or try again in a few minutes. | Pick another server |
| `src/core/session/state.ts:262` | copy | The Solana network endpoint didn't answer in time, so nothing was paid. Try again in a minute, or add your own RPC endpoint in Settings. | Retry |
| `src/core/session/state.ts:263` | copy | The server didn't answer in time. | Retry |
| `src/core/session/state.ts:264` | copy | The payment transaction was rejected by the network program. | Try stream payment |
| `src/core/session/state.ts:267` | copy | The VPN service's Solana connection has run out of credit. Set another address in Settings, under Solana connection for the VPN service. | Open settings |
| `src/core/session/state.ts:268` | copy | The Solana network endpoint is rate-limiting requests. Wait a minute and try again, or add your own RPC endpoint in Settings. | Retry |
| `src/core/session/state.ts:271` | copy | The server had a problem starting your session. Your deposit with it is kept and will be used when you try again. Try again in a minute, or pick another server. | Retry |
| `src/core/session/state.ts:274` | copy | The Solana network is busy right now, so nothing was paid. Wait a minute and try again, or add your own RPC endpoint in Settings. | Retry |
| `src/core/session/state.ts:278` | copy | Something went wrong. Retry. | Retry |
| `src/core/session/state.ts:439` | return | Split tunnelling works with the kill switch off on this version. Every app uses the VPN. |  |
| `src/core/session/state.ts:441` | return | Split tunnelling needs a newer VPN service. Every app uses the VPN. |  |
| `src/core/session/state.ts:443` | return | V2Ray and Xray work as a proxy here: only apps that use the proxy go through the VPN, so split tunnelling does not apply. Use WireGuard, AmneziaWG, OpenVPN or Hysteria2 to split by address. |  |
| `src/core/session/state.ts:444` | return | Turn on "Whole computer" for V2Ray and Xray to use split tunnelling. Until then only apps set to use the proxy use the VPN. |  |
| `src/core/session/state.ts:451` | return | Choosing apps on this server needs a newer VPN service. Every app uses the VPN. |  |
| `src/core/session/state.ts:456` | return | Split tunnelling needs a newer VPN service. Every app uses the VPN. |  |
| `src/core/session/state.ts:459` | return | Split tunnelling is not available for this server. Every app uses the VPN. |  |
| `src/core/session/state.ts:465` | return | The kill switch does not work with ${name} on Windows yet: it blocks the VPN itself. Turn the kill switch off in Settings, or pick a Hysteria2, V2Ray or Xray server. Nothing was paid. |  |
| `src/core/wallet/keys.ts:44` | throw | The derivation path "${path}" must start with m/, like m/44'/501'/0'/0'. |  |
| `src/core/wallet/keys.ts:47` | throw | Every derivation path segment must be hardened (end with '), unlike "${seg}". |  |
| `src/core/wallet/keys.ts:71` | throw | That key file is not valid JSON: ${(err as Error).message} |  |
| `src/core/wallet/keys.ts:74` | throw | That key file is not a Solana key (expected a JSON array of 64 numbers, as written by solana-keygen). |  |
| `src/core/wallet/keys.ts:100` | throw | Paste a recovery phrase, a key file, or a private key. |  |
| `src/core/wallet/keys.ts:103` | throw | That recovery phrase is not valid. Check the words and their order. |  |
| `src/core/wallet/keys.ts:110` | throw | That private key is not valid base58: ${(err as Error).message} |  |
| `src/core/wallet/keys.ts:114` | throw | A private key is 64 bytes (got ${raw.length}). |  |
| `src/core/wallet/new-keyfile.ts:24` | throw | Could not write the key file ${abs}: ${(err as Error).message} |  |
| `src/main/android/android-bridge.ts:17` | throw | The Android app bridge is not available (DVPN_APP_BRIDGE unset): run this CLI from the app. |  |
| `src/main/android/android-bridge.ts:62` | throw | Android app bridge sent an unreadable reply: ${(err as Error).message} |  |
| `src/main/android/android-bridge.ts:69` | throw | Android Keystore could not encrypt the wallet: ${r.error ?? 'no data'} |  |
| `src/main/android/android-bridge.ts:75` | throw | Android Keystore could not decrypt the wallet (was the app reinstalled?): ${r.error ?? 'no data'} |  |
| `src/main/android/split-apps.ts:44` | throw | Split mode must be one of ${SPLIT_MODES.join(', ')}. |  |
| `src/main/android/split-apps.ts:47` | throw | Not an IP address or network (like 10.0.0.0/8): ${bad.slice(0, 3).join(', ')} |  |
| `src/main/android/split-apps.ts:48` | throw | At most ${MAX_ROUTES} addresses. |  |
| `src/main/android/split-apps.ts:49` | throw | "Only these addresses" needs at least one address; otherwise everything would use the VPN. |  |
| `src/main/android/split-apps.ts:65` | throw | Split mode must be one of ${SPLIT_MODES.join(', ')}. |  |
| `src/main/android/split-apps.ts:67` | throw | Not an Android package name: ${bad.slice(0, 3).join(', ')} |  |
| `src/main/android/split-apps.ts:69` | throw | At most ${MAX_PACKAGES} apps. |  |
| `src/main/android/split-apps.ts:70` | throw | "Only these apps" needs at least one app; otherwise every app would use the VPN. |  |
| `src/main/daemon/manager.ts:586` | result | The VPN service is missing from this install. Reinstall the app. |  |
| `src/main/daemon/manager.ts:589` | result | A half-finished setup exists. Remove it from Settings → Advanced and start again. |  |
| `src/main/daemon/manager.ts:597` | result | Could not set up the VPN service. Try again, or send the log from Diagnostics (${(err?.message ?? String(stderr)).slice(0, 300)}). |  |
| `src/main/daemon/manager.ts:607` | result | Could not set up the VPN service. Try again, or send the log from Diagnostics (unreadable output: ${(parseErr as Error).message}). |  |
| `src/main/daemon/manager.ts:678` | result | On Windows, remove Devnet dVPN from Settings > Apps: that removes the VPN service too. |  |
| `src/main/daemon/manager.ts:683` | result | Initialise the device first. |  |
| `src/main/daemon/manager.ts:760` | result | The VPN service did not start. Open Diagnostics and run the check to see why. |  |
| `src/main/daemon/manager.ts:794` | result | The VPN service is missing from this install. Reinstall the app. |  |
| `src/main/daemon/manager.ts:799` | result | Could not read the service's device key (${(err?.message ?? String(stderr)).trim().slice(0, 160)}). Enter its address instead. |  |
| `src/main/daemon/manager.ts:803` | result | The service home has no device key. |  |
| `src/main/daemon/manager.ts:805` | result | Could not read the service's device key (unreadable output: ${(parseErr as Error).message}). Enter its address instead. |  |
| `src/main/daemon/manager.ts:813` | throw | The device must be a Solana address (base58). |  |
| `src/main/daemon/manager.ts:828` | result | Only the Android app restarts its own VPN engine. |  |
| `src/main/daemon/migrate-run.ts:58` | throw | The old service uninstall failed: ${r.out.trim().slice(0, 300)} |  |
| `src/main/daemon/migrate-run.ts:70` | throw | Setting up the new service home failed: ${r.out.trim().slice(0, 300)} |  |
| `src/main/daemon/migrate-run.ts:74` | throw | Setting up the new service home wrote no ${step.into} |  |
| `src/main/daemon/settings.ts:131` | result | This app cannot read the VPN service settings on this account. Run the app once as administrator or re-run setup. |  |
| `src/main/host.ts:33` | throw | host not initialised |  |
| `src/main/ipc.ts:59` | result | Confirm first. |  |
| `src/main/ipc.ts:72` | throw | invalid input |  |
| `src/main/ipc.ts:81` | throw | only https links open externally |  |
| `src/main/ipc.ts:104` | throw | Unknown server. |  |
| `src/main/ipc.ts:138` | result | That is not a device address. |  |
| `src/main/ipc.ts:142` | result | That computer can still pay for sessions. Remove its spending limit first; then its deposits can be refunded here. |  |
| `src/main/ipc.ts:165` | result | Third-party checks are off in Settings. |  |
| `src/main/ipc.ts:166` | result | Third-party checks are off in Settings. |  |
| `src/main/ipc.ts:189` | result | Cancelled. |  |
| `src/main/ipc.ts:196` | result | This session has no SOCKS endpoint (only V2Ray/Xray sessions do). Nothing was changed. |  |
| `src/main/ipc.ts:202` | result | This session has no SOCKS endpoint (only V2Ray/Xray sessions do). Nothing was opened. |  |
| `src/main/ipc.ts:212` | result | Cancelled. |  |
| `src/main/ipc.ts:227` | result | Cancelled. |  |
| `src/main/ipc.ts:228` | result | That file is too large to be a key file. |  |
| `src/main/ipc.ts:241` | result | Enter the full endpoint URL, including its API key, or leave it unchanged. |  |
| `src/main/ipc.ts:249` | result | Set up a wallet first. |  |
| `src/main/ipc.ts:255` | result | Finish device setup first: the service will not start without it. |  |
| `src/main/ipc.ts:275` | result | Finish device setup first: the service will not start without it. |  |
| `src/main/ipc.ts:300` | result | That is not a device address. |  |
| `src/main/ipc.ts:326` | throw | invalid server list |  |
| `src/main/scheduler.ts:257` | throw | No background job "${name}" (the session poll runs only during a session). |  |
| `src/main/services/activity.ts:115` | result | Set up a wallet first. |  |
| `src/main/services/activity.ts:118` | result | Enter an amount. |  |
| `src/main/services/activity.ts:121` | result | That deposit was not found on the network (it may already be closed). |  |
| `src/main/services/activity.ts:122` | result | That deposit is not yours. |  |
| `src/main/services/activity.ts:123` | result | That deposit is closing; it cannot be topped up. |  |
| `src/main/services/cli-exec.ts:124` | result | Could not prepare the terminal: ${(err as Error).message} |  |
| `src/main/services/cli-exec.ts:133` | result | Terminal could not be opened. Run devnet-dvpn from your own terminal. |  |
| `src/main/services/cli-exec.ts:149` | result | Could not prepare the terminal: ${(err as Error).message} |  |
| `src/main/services/cli-exec.ts:153` | result | PowerShell is Windows-only; run the CLI from your terminal. |  |
| `src/main/services/connect-checks.ts:33` | result | Disconnect the current session first. |  |
| `src/main/services/connect-checks.ts:38` | result | That server is not on the network any more. | Pick another server |
| `src/main/services/connect-checks.ts:39` | result | That server has not checked in recently. Pick another. | Pick another server |
| `src/main/services/connect-checks.ts:41` | result | ${probe.error ?? 'Server check failed'}. Nothing was paid. | Pick another server |
| `src/main/services/connect-checks.ts:48` | result | The OpenVPN network adapter is missing and could not be added back (${fixed.detail}). Repair drivers, then connect again. Nothing was paid. | Open diagnostics |
| `src/main/services/connect-checks.ts:59` | result | This server does not sell ${req.basis === 'per_gb' ? 'per GB' : 'per hour'}. |  |
| `src/main/services/connection.ts:264` | throw | cancelled |  |
| `src/main/services/connection.ts:428` | result | DNS could not be restored. | Restore network |
| `src/main/services/connection.ts:434` | result | Your internet may not work. | Restore network |
| `src/main/services/connection.ts:441` | result | Confirm the cost first. |  |
| `src/main/services/connection.ts:443` | fail | A server test is running and uses the VPN service. Stop the test first, or wait for it to finish. |  |
| `src/main/services/connection.ts:455` | fail | Set up a wallet first. |  |
| `src/main/services/connection.ts:533` | fail | Finish device setup first. |  |
| `src/main/services/connection.ts:581` | fail | You left the old server, but your internet has not come back yet, so nothing was paid for the new one. Wait a moment and connect again. |  |
| `src/main/services/connection.ts:591` | fail | This plan gives access on ${servers}, and you already use ${limit.max === 1 ? 'it' : 'them'}. Connect to one of those, or get another plan. |  |
| `src/main/services/connection.ts:676` | fail | ${copy.message} Another VPN (${rivals.join(', ')}) is on and is probably blocking this: turn it off, then connect again. |  |
| `src/main/services/connection.ts:748` | toast | Cancel came too late: the connection is up. Press Disconnect to end it. |  |
| `src/main/services/connection.ts:1111` | result | DNS could not be restored. | Restore network |
| `src/main/services/connection.ts:1117` | result | Your internet may not work. | Restore network |
| `src/main/services/connection.ts:1293` | return | The VPN service stopped and has not started again, so the session ended. ${ks !== 'off' ? 'The kill switch keeps the internet blocked until it does, so nothing leaks. ' : ''}Press Restore network to start it now and get your normal connection back. |  |
| `src/main/services/connection.ts:1592` | result | The VPN service is not answering. ${osWord('restartService', process.platform)}, then press Restore network again. |  |
| `src/main/services/device-topup.ts:25` | toast | Sent this device ${sol(lamports)} SOL from your wallet for network fees. |  |
| `src/main/services/node-test.ts:149` | result | Pick at least one server. |  |
| `src/main/services/node-test.ts:267` | result | Confirm the deposit limit first. |  |
| `src/main/services/node-test.ts:268` | result | A test run is already going. |  |
| `src/main/services/node-test.ts:269` | result | Disconnect first: a test uses the VPN service, which runs one session at a time. |  |
| `src/main/services/node-test.ts:271` | result | Set up a wallet first. |  |
| `src/main/services/node-test.ts:277` | result | The VPN service on this computer is set up for a different wallet, so a test would pay from that wallet. Connect once with this wallet (that sets the service up for it), disconnect, then run the test again. Nothing was paid. |  |
| `src/main/services/node-test.ts:283` | result | There is no unfinished test run to continue. |  |
| `src/main/services/node-test.ts:286` | result | Pick at least one server. |  |
| `src/main/services/node-test.ts:287` | result | Set the deposit limit first. |  |
| `src/main/services/node-test.ts:289` | result | None of those servers is on the network. |  |
| `src/main/services/node-test.ts:292` | result | Each of these servers needs a deposit over your limit of ${tdvpn(req.maxSpend)} tDVPN. The smallest limit that tests any of them is ${tdvpn(plan.smallestLimit)} tDVPN. |  |
| `src/main/services/node-test.ts:298` | result | This run pays ${tdvpn(short.needs)} tDVPN in deposits, one server after another, and this computer's spending limit has ${tdvpn(short.left)} tDVPN left. A closed deposit does not give the limit back. Raise the spending limit in Wallet to at least ${tdvpn(short.needs)} tDVPN, then start again. Nothing was paid. |  |
| `src/main/services/node-test.ts:433` | result | The test run stopped on a problem of its own. Deposits it opened are closed when you continue the run. |  |
| `src/main/services/nodes.ts:80` | throw | "${address}" is not a server address. |  |
| `src/main/services/plans.ts:80` | return | This plan's provider is not answering right now, so its server list can't be shown. Try again later or pick another plan. |  |
| `src/main/services/plans.ts:97` | result | Confirm the price first. |  |
| `src/main/services/plans.ts:99` | result | Set up a wallet first. |  |
| `src/main/services/plans.ts:101` | result | That plan is not listed any more. |  |
| `src/main/services/plans.ts:102` | result | This plan's provider is not active. |  |
| `src/main/services/plans.ts:116` | result | Set up a wallet first. |  |
| `src/main/services/plans.ts:118` | result | Subscription not found. |  |
| `src/main/services/settlement.ts:70` | throw | That is ${isAndroid() ? 'this phone' : 'this computer'}'s device: leave out --device. |  |
| `src/main/services/settlement.ts:177` | result | A refund is already running. |  |
| `src/main/services/settlement.ts:182` | result | Set up a wallet first. |  |
| `src/main/services/settlement.ts:270` | result | The VPN service stopped during the refund. Nothing was lost; it runs again shortly. |  |
| `src/main/services/settlement.ts:315` | result | Set up a wallet first. |  |
| `src/main/services/settlement.ts:317` | result | Nothing to refund. |  |
| `src/main/services/wallet.ts:103` | result | This computer has no spending limit, so it cannot pay for a connection. Turn on "Set up payments on first connect" in Settings, or set a spending limit in Wallet. | Open Settings |
| `src/main/services/wallet.ts:104` | result | Set up this computer's spending permission in Wallet first. | Open Wallet |
| `src/main/services/wallet.ts:129` | result | Could not set up payments for this computer: ${lastAutoError} | Retry |
| `src/main/services/wallet.ts:143` | result | Create or import a wallet first (wallet create / wallet import). |  |
| `src/main/services/wallet.ts:144` | result | ${isAndroid() ? 'This phone' : 'This computer'} has no device key yet. Create it on the Welcome screen first. |  |
| `src/main/services/wallet.ts:157` | result | The VPN service has no device key yet. |  |
| `src/main/services/wallet.ts:180` | result | No device is set up. |  |
| `src/main/services/wallet.ts:200` | result | That is not a device address. |  |
| `src/main/services/wallet.ts:201` | result | That is ${isAndroid() ? 'this phone' : 'this computer'}'s device: run device revoke without --device. |  |
| `src/main/services/wallet.ts:223` | result | Confirm the transfer first. |  |
| `src/main/services/wallet.ts:224` | result | That is not a Solana wallet address. |  |
| `src/main/services/wallet.ts:227` | result | Enter an amount. |  |
| `src/main/store.ts:14` | throw | store not initialised |  |
| `src/main/system/browser.ts:30` | throw | "${endpoint}" is not a local SOCKS endpoint. |  |
| `src/main/system/cli-shell.ts:5` | result | Run devnet-dvpn from your own terminal. |  |
| `src/main/system/dns-probe.ts:66` | return | None of these DNS servers answered from this computer (${rows.map((r) => r.server).join(', ')}): names may not resolve in a session. Choose another, e.g. "daemon set --dns cloudflare --yes". |  |
| `src/main/system/drivers.ts:107` | result | Drivers are installed by the Windows app only. |  |
| `src/main/system/elevate.ts:24` | throw | refusing unsafe argument for elevated step: ${s} |  |
| `src/main/system/elevate.ts:31` | throw | bad parameter name ${k} |  |
| `src/main/system/proxy.ts:43` | throw | system proxy helper printed no state: ${out.slice(0, 120)} |  |
| `src/main/system/proxy.ts:105` | throw | refusing non-loopback proxy endpoint ${endpoint} |  |
| `src/main/system/proxy.ts:108` | throw | The VPN's SOCKS proxy is not answering on this computer (${live.reason}). Nothing was changed. |  |
| `src/main/system/proxy.ts:117` | throw | Windows did not accept the proxy setting. Nothing else was changed. |  |
| `src/main/wallet/electron-keystore.ts:22` | throw | This computer cannot safely store your wallet key. Sign in to your Windows account and try again. |  |
| `src/main/wallet/electron-keystore.ts:36` | throw | Your stored wallet could not be unlocked on this Windows account. |  |
| `src/main/wallet/vault.ts:32` | throw | Set up a wallet first. |  |
| `src/main/wallet/vault.ts:42` | throw | A wallet is already set up on this computer (${cur}). Back up its recovery phrase, log out, then try again. Nothing was changed. |  |
| `src/preload/index.ts:17` | throw | blocked event ${channel} |  |
| `src/renderer/src/App.tsx:329` | banner | The VPN service is set up for a different network than this app. Connecting is blocked until it is re-installed for Solana devnet. |  |
| `src/renderer/src/components/gallery-fixtures.ts:60` | copy | The Solana network did not answer in time, so nothing was paid. Try again in a moment. | Try again |
| `src/renderer/src/components/Gallery.tsx:137` | banner | The VPN service is starting. This takes a few seconds. |  |
| `src/renderer/src/components/Gallery.tsx:138` | banner | Your deposit ran out. |  |
| `src/renderer/src/components/Gallery.tsx:139` | banner | Your internet may be blocked. Restore network releases it. |  |
| `src/renderer/src/components/Gallery.tsx:196` | toast | 12.4 tDVPN is back in your wallet. |  |
| `src/renderer/src/components/Gallery.tsx:197` | toast | About 10 minutes left at this rate. |  |
| `src/renderer/src/components/Gallery.tsx:198` | toast | The Solana network did not answer. Nothing was paid. |  |
| `src/renderer/src/components/Gallery.tsx:200` | toast | Address copied. |  |
| `src/renderer/src/components/Gallery.tsx:218` | throw | The Solana network did not answer. Nothing was changed. |  |
| `src/renderer/src/components/PollSettings.tsx:16` | toast | ${j.label}: use a whole number of seconds from ${j.min} to ${j.max}. |  |
| `src/renderer/src/components/PollSettings.tsx:42` | toast | Refresh cadences back to defaults. |  |
| `src/renderer/src/components/SidebarFooter.tsx:33` | toast | Create or import a wallet first. |  |
| `src/renderer/src/components/SidebarFooter.tsx:37` | toast | Your address is copied. Paste it into the ${what} faucet page. |  |
| `src/renderer/src/components/SidebarFooter.tsx:39` | toast | Your address is copied. Have ${what} sent to it; it shows in Wallet. |  |
| `src/renderer/src/screens/android/AboutAndroid.tsx:15` | throw | Notices: http ${r.status} |  |
| `src/renderer/src/screens/android/AboutAndroid.tsx:17` | toast | The licence notices could not be opened. |  |
| `src/renderer/src/screens/android/KillSwitchAndroid.tsx:87` | banner | The VPN engine settings can&apos;t be read yet. Open the app once more in a moment. |  |
| `src/renderer/src/screens/android/SplitTunnelAndroid.tsx:136` | banner | Tick at least one app, or choose All apps. |  |
| `src/renderer/src/screens/android/SplitTunnelAndroid.tsx:137` | banner | Add at least one address, or choose All addresses. |  |
| `src/renderer/src/screens/Cli.tsx:122` | toast | Command copied. |  |
| `src/renderer/src/screens/Cli.tsx:124` | toast | Instructions copied. Paste them to your agent. |  |
| `src/renderer/src/screens/Cli.tsx:151` | toast | Copied. |  |
| `src/renderer/src/screens/Home.tsx:148` | toast | Your address is copied. Paste it into the faucet page. |  |
| `src/renderer/src/screens/Home.tsx:148` | banner | Your wallet has no SOL for network fees yet. |  |
| `src/renderer/src/screens/Home.tsx:153` | banner | Your wallet has no tDVPN yet. |  |
| `src/renderer/src/screens/Home.tsx:167` | banner | Your internet may be blocked. Restore network releases it. |  |
| `src/renderer/src/screens/NodeTest.tsx:125` | banner | Disconnect first: the VPN service runs one session at a time, so testing waits until you are off the VPN. |  |
| `src/renderer/src/screens/NodeTest.tsx:238` | toast | Results copied. |  |
| `src/renderer/src/screens/Settings.tsx:331` | toast | App settings restored to defaults. |  |
| `src/renderer/src/screens/SplitTunnel.tsx:171` | banner | Apps you leave out use your normal connection and show your real IP address. |  |
| `src/renderer/src/screens/Wallet.tsx:108` | toast | This limit is already set. |  |
| `src/shared/money-toast.ts:6` | return | Topped up ${amountTdvpn} tDVPN. |  |
| `src/shared/money-toast.ts:12` | return | No refund is ready yet. Each one arrives automatically when its 2-hour wait ends. |  |
| `src/shared/money-toast.ts:17` | return | Added ${amountTdvpn} tDVPN of refunds to your wallet. |  |
| `src/shared/money-toast.ts:21` | return | Sent ${amount} ${asset === 'sol' ? 'SOL' : 'tDVPN'} to ${to.slice(0, 4)}…${to.slice(-4)}. |  |
