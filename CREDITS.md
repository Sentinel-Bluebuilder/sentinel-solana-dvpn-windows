# Credits

This is the file that section 8 of [LICENSE](LICENSE) refers to. Third-party material is licensed by
its own authors under its own terms.

## Programs the Windows installer bundles

The installer ships these programs unmodified. Each is pinned by version and SHA-256 in
[`build/deps.lock.json`](build/deps.lock.json), which also gives each one's license and source.
[`scripts/fetch-deps.mjs`](scripts/fetch-deps.mjs) refuses any file that does not match. The same
script writes `THIRD-PARTY-NOTICES.txt` at build time, and the installer places it in the install
folder next to the app.

| Program | License |
|---|---|
| WireGuard for Windows | MIT |
| AmneziaWG for Windows | MIT |
| OpenVPN Community 2.6 | GPL-2.0 |
| Hysteria 2 | MIT |
| V2Ray | MIT |
| Xray | MPL-2.0 |
| Wintun | Wintun Prebuilt Binaries License |

## Compiled into the VPN service

`go-sqlite3-wasm` (MIT No Attribution):
[`resources/bin/go-sqlite3-wasm-LICENSE.txt`](resources/bin/go-sqlite3-wasm-LICENSE.txt).

## Libraries

The app's npm dependencies (Electron, React and others) are listed with their versions in
[`package-lock.json`](package-lock.json). Each package carries its own license file.
