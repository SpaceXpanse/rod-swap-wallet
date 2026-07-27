<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) SpaceXpanse contributors -->

# rod-web-swap

Static browser-based SpaceXpanse ROD wallet with an integrated OTC swap runtime.

## Status

The current shipped release is [`2.8.0-alpha.0`](CHANGELOG.md:12).

This repository is still experimental, but the shipped runtime is no longer just a ROD↔LTC prototype. The current OTC surface covers ROD swaps against Litecoin, Dogecoin, Bitcoin, and Bitcoin Cash, as reflected in [`CHANGELOG.md`](CHANGELOG.md:12).

## Experimental disclaimer

> [!WARNING]
> **Do not treat this project as production-ready.**
>
> The author is **not** a cryptographer, and this work has **not** been externally reviewed. There may still be a fatal flaw.
>
> This repository should still be treated as **experimental** and used **only for testing**.
>
> The current shipped runtime supports fully non-custodial OTC swap flows across ROD and supported Bitcoin-derived counter chains, but it should **not** be used for meaningful value.

Proof artifacts and screenshots live under [`proof/`](proof).

## Overview

[`rod-web-swap`](README.md) is a static, browser-based, non-custodial SpaceXpanse ROD wallet. Key generation and signing remain in the browser. Chain lookups, UTXO discovery, transaction fetch, and broadcast still depend on chain APIs, while OTC coordination uses the ROD blockchain plus Nostr relay messaging.

The main OTC runtime lives in [`js/otc-app-ui.js`](js/otc-app-ui.js), [`js/otc-engine.js`](js/otc-engine.js), [`js/otc-swap.js`](js/otc-swap.js), [`js/otc-chains.js`](js/otc-chains.js), [`js/otc-explorer.js`](js/otc-explorer.js), and [`js/otc-nostr.js`](js/otc-nostr.js).

The shipped swap flow includes planned funding txids, pre-signed timelocked refunds, `PREPARED` gating before funding broadcast, automated refund monitoring, and in-browser recovery after reload, as tracked in [`CHANGELOG.md`](CHANGELOG.md:12).

## What is implemented

### Wallet

- Local key generation and transaction signing in the browser through [`js/coin.js`](js/coin.js) and [`js/coinbin.js`](js/coinbin.js)
- Wallet send/receive flows in [`index.html`](index.html) and [`js/coinbin.js`](js/coinbin.js)
- Offline transaction decode, verify, rebuild, and sign flows
- API-backed balance, UTXO, transaction lookup, and broadcast handling through [`coinjs.addressBalance()`](js/coin.js:419), [`coinjs.transaction().listUnspent()`](js/coin.js:1197), [`coinjs.transaction().getTransaction()`](js/coin.js:1239), and [`coinjs.transaction().broadcast()`](js/coin.js:1322)
- Deterministic local fee guidance rather than remote fee estimation, centered on [`ensureWalletFeeMeetsRelayFloor()`](js/coinbin.js:463)
- PWA shell support through [`manifest.webmanifest`](manifest.webmanifest) and [`sw.js`](sw.js)

### OTC runtime

- OTC UI integrated directly into [`index.html`](index.html)
- On-chain order publication/discovery model using the ROD name/value database with optional local helper/proxy support
- Nostr-based peer signaling through [`js/otc-nostr.js`](js/otc-nostr.js)
- Adaptor-signature-based claim flow using [`js/ecdsa-adaptor.js`](js/ecdsa-adaptor.js)
- Planned funding txids before broadcast
- Pre-signed timelocked refunds on both chains
- `REFUNDS_READY → SIGNATURES_EXCHANGED → PREPARED` gating before funding broadcast
- Confirmation-gated settlement progression
- Automated refund monitoring and refund terminal states
- Reload-resilient in-browser swap persistence

## Wallet and chain scope

The shipped wallet shell exposes ROD, LTC, DOGE, BTC, and BCH in the coin selector in [`index.html`](index.html). ROD remains the primary wallet/network context, while the OTC runtime treats the counter leg as a generic `alt` chain selected from those supported networks.

Current shipped OTC scope:

- ROD ↔ LTC
- ROD ↔ DOGE
- ROD ↔ BTC
- ROD ↔ BCH

The explorer/backend adapter layer in [`js/otc-explorer.js`](js/otc-explorer.js) normalizes multiple backend families into one downstream shape:

- ROD direct API wrappers
- Esplora-style backends for LTC and BTC
- BlockCypher-backed DOGE access
- Blockchair-backed BCH access

## Chain-aware caveats

Multi-chain behavior is not interchangeable across all supported networks.

- Per-chain relay policy, fee floors, dust thresholds, refund timing, and change rules are centralized in [`js/otc-chains.js`](js/otc-chains.js).
- DOGE has no SegWit support; BTC and LTC support SegWit; BCH uses its own fork-id signing path.
- BTC and BCH deliberately share Bitcoin legacy version bytes, so address shape alone is not enough to identify the chain. OTC logic must stay bound to hashed `terms.altChain`, not inferred from the address form.
- Nostr peer messages are not proof of settlement by themselves; signature validation and remote-peer checks are enforced in [`js/otc-nostr.js`](js/otc-nostr.js).

## Quick start

### Run the wallet

There is no root [`package.json`](package.json) and no build step for the main application.

To run the wallet:

1. Open [`index.html`](index.html) directly in a browser, or
2. Serve the repository as static files and load [`index.html`](index.html)

Default runtime assumptions:

- ROD API base defaults to `https://api.spacexpanse.org:1234`
- Script-tag ordering in [`index.html`](index.html) is a runtime requirement
- Donation output is disabled by default

### Use OTC mode

1. Open the OTC tab in [`index.html`](index.html)
2. Select the intended alt chain explicitly
3. Confirm the chain-specific API/backend settings in OTC Settings
4. If you need name operations or local order publication through ROD Core RPC, run the helper documented in [`tools/README.md`](tools/README.md)

The optional helper flow uses [`tools/rod-rpc-cors-proxy.exe`](tools/rod-rpc-cors-proxy.exe) or [`tools/rod-rpc-cors-proxy.js`](tools/rod-rpc-cors-proxy.js) as described in [`tools/README.md`](tools/README.md).

## Verification and proofs

### Fast proof gate

Run [`node unit-browser-test.js`](tests/harness/unit-browser-test.js:1) from [`tests/harness/`](tests/harness).

This covers fast browser-side invariants for chain constants, explorer normalization, fee/dust policy, terms binding, and related protocol assumptions.

### Full harness

Run [`bash tests/harness/run-all.sh`](tests/harness/run-all.sh:1) from the workspace root after installing harness dependencies in [`tests/harness/package.json`](tests/harness/package.json).

The matrix runner executes happy-path, ROD-refund, alt-refund, and reload scenarios across LTC, DOGE, BTC, and BCH using the real unmodified app in headless Chromium against mock chains that independently re-verify every broadcast.

### Windows / local runner notes

- [`tests/harness/run-all.sh`](tests/harness/run-all.sh:1) resolves Node via `node`, `node.exe`, or `NODE_BIN`.
- [`tests/harness/unit-browser-test.js`](tests/harness/unit-browser-test.js:1) and [`tests/harness/e2e-swap-test.js`](tests/harness/e2e-swap-test.js:1) accept `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` or `PW_CHROMIUM_EXECUTABLE_PATH` if Chromium is not found through the default Playwright location.
- On Windows hosts where checked-in CRLF line endings block `bash`, run the full harness through a temporary LF-normalized copy rather than rewriting the tracked script.

### Visual proof artifacts

Screenshots and proof artifacts are available under [`proof/`](proof), including [`proof/orderbook.jpg`](proof/orderbook.jpg), [`proof/active-swap-detail.jpg`](proof/active-swap-detail.jpg), [`proof/ltc-wallet.jpg`](proof/ltc-wallet.jpg), and [`proof/rod-wallet.jpg`](proof/rod-wallet.jpg).

## Current limitations

- This project remains experimental and has not been cryptographically reviewed
- Live OTC success still depends on working chain APIs and relay delivery
- Some name/orderbook operations still depend on the optional local RPC/proxy path in [`tools/README.md`](tools/README.md)
- Script-tag ordering in [`index.html`](index.html) must remain intact
- PWA shell integrity depends on keeping [`sw.js`](sw.js) aligned with cached assets
- ROD API response handling expects the current `{result,error}` envelope behavior

## Repository structure

```text
.
├─ index.html
├─ js/
│  ├─ coin.js
│  ├─ coinbin.js
│  ├─ otc-app-ui.js
│  ├─ otc-chains.js
│  ├─ otc-engine.js
│  ├─ otc-explorer.js
│  ├─ otc-nostr.js
│  └─ otc-swap.js
├─ tests/
│  └─ harness/
├─ tools/
├─ docs/
├─ proof/
├─ sw.js
└─ manifest.webmanifest
```

## Further reading

- Release history and shipped behavior: [`CHANGELOG.md`](CHANGELOG.md)
- OTC proof harness docs: [`tests/README.md`](tests/README.md) and [`tests/harness/README.md`](tests/harness/README.md)
- Optional RPC helper: [`tools/README.md`](tools/README.md)
- Technical specification: [`docs/technical_specification_rod_web_swap.pdf`](docs/technical_specification_rod_web_swap.pdf)
- Durable maintainer docs: [`docs/maintainer-wiki/index.md`](docs/maintainer-wiki/index.md)

## Attribution

This project is derived from the browser-wallet lineage represented by [`coinbin`](README.md), but current behavior should be understood through the SpaceXpanse ROD runtime, shipped OTC modules, and the repository-specific documentation linked above.

## Licensing

- Original Coinb.in-derived material in this repository remains under the MIT license in [`LICENSE`](LICENSE).
- SpaceXpanse/ROD fork-specific additions are licensed under Apache License 2.0 in [`LICENSE-APACHE`](LICENSE-APACHE), unless a file states otherwise.
- Repository distributions should preserve both [`LICENSE`](LICENSE) and [`LICENSE-APACHE`](LICENSE-APACHE).
