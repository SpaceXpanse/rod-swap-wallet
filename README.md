<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) SpaceXpanse contributors -->

# rod-web-swap

Static browser-based SpaceXpanse ROD wallet with an integrated experimental OTC swap engine.

## Experimental disclaimer

> [!WARNING]
> **Do not treat this project as production-ready.**
> 
> The author is **not** a cryptographer, and this work has **not** been externally reviewed. That means there is very likely a fatal flaw somewhere.
> 
> This repository is still **highly experimental**, should be treated as a **proof of concept**, and should be used **only for testing**.
> 
> It has achieved the ability to perform **fully non-custodial swaps between two Bitcoin-derived blockchains** in its current proof-of-concept form, but it should **not** be used to swap serious amounts.
> 
> Proof artifacts and screenshots live under [`proof/`](proof).

## Overview

[`rod-web-swap`](README.md) is a static, browser-based, non-custodial SpaceXpanse ROD wallet with an integrated OTC swap engine. Key generation and signing remain inside the browser, while selected chain operations use the SpaceXpanse ROD API and OTC coordination uses the ROD blockchain, Nostr relay messaging, and browser-native adaptor-signature logic.

The OTC subsystem is implemented directly in the main wallet shell through [`js/otc-app-ui.js`](js/otc-app-ui.js), [`js/otc-engine.js`](js/otc-engine.js), [`js/otc-nostr.js`](js/otc-nostr.js), and [`js/otc-swap.js`](js/otc-swap.js). The current runtime includes planned funding txids, pre-signed timelocked refunds, `PREPARED` settlement gating, automated refund monitoring, and persistent in-browser swap recovery, as tracked in [`CHANGELOG.md`](CHANGELOG.md).

## What is implemented

### Wallet

- Local key generation and transaction signing in the browser through [`js/coin.js`](js/coin.js) and [`js/coinbin.js`](js/coinbin.js)
- ROD wallet send/receive flows in [`index.html`](index.html) and [`js/coinbin.js`](js/coinbin.js)
- Offline transaction decode, verify, rebuild, and sign flows
- ROD API-backed balance, UTXO, transaction lookup, and broadcast handling through [`coinjs.addressBalance()`](js/coin.js:419), [`coinjs.transaction().listUnspent()`](js/coin.js:1197), [`coinjs.transaction().getTransaction()`](js/coin.js:1239), and [`coinjs.transaction().broadcast()`](js/coin.js:1322)
- Deterministic local fee guidance rather than remote fee estimation, centered on [`ensureWalletFeeMeetsRelayFloor()`](js/coinbin.js:463)
- PWA shell support through [`manifest.webmanifest`](manifest.webmanifest) and [`sw.js`](sw.js)

### OTC swap engine

- Serverless browser OTC runtime integrated into [`index.html`](index.html)
- On-chain order publication/discovery model using the ROD name/value database and optional local RPC/proxy support
- Nostr-based peer signaling through [`js/otc-nostr.js`](js/otc-nostr.js)
- Adaptor-signature-based claim flow using [`js/ecdsa-adaptor.js`](js/ecdsa-adaptor.js)
- Planned funding txids before broadcast
- Pre-signed timelocked refunds on both chains
- `REFUNDS_READY → SIGNATURES_EXCHANGED → PREPARED` gating before funding broadcast
- Confirmation-gated settlement progression
- Automated refund monitoring and refund terminal states
- Reload-resilient in-browser swap persistence
- End-to-end browser proof harness coverage in [`tests/README.md`](tests/README.md) and [`tests/harness/README.md`](tests/harness/README.md)

## Architecture at a glance

The project follows a three-layer model that matches the technical specification in [`docs/technical_specification_rod_web_swap.pdf`](docs/technical_specification_rod_web_swap.pdf):

- **Local browser sandbox / PWA client** — UI, state handling, wallet logic, and cryptographic execution run inside the browser
- **ROD blockchain layer** — used as the decentralized orderbook and settlement-adjacent coordination layer
- **Nostr signaling layer** — used for ephemeral peer-to-peer negotiation and swap message exchange

At repository level, the main entrypoints are:

- [`index.html`](index.html) — single-page wallet and OTC shell
- [`js/coin.js`](js/coin.js) — network constants, signing helpers, transaction logic, and API wrappers
- [`js/coinbin.js`](js/coinbin.js) — wallet UI controller and transaction flows
- [`js/otc-app-ui.js`](js/otc-app-ui.js) — OTC dashboard, swap UI, and operator flows
- [`js/otc-engine.js`](js/otc-engine.js) — OTC orchestration, live session state, API access, and relay/runtime glue
- [`js/otc-swap.js`](js/otc-swap.js) — deterministic swap/session construction and state transitions

A durable maintainer summary of the runtime architecture lives in [`docs/maintainer-wiki/concept-architecture-overview.md`](docs/maintainer-wiki/concept-architecture-overview.md).

## Trust and security model

This repository aims for **non-custodial execution**, not production-grade safety.

- Private keys are intended to remain in local browser execution paths
- The wallet is offline-first for signing, but **not fully offline** for balance lookup, UTXO discovery, transaction lookup, broadcast, and OTC coordination
- OTC coordination is separated from custody, but still depends on chain APIs, Nostr delivery, and optional local RPC/proxy flows for some name/orderbook operations
- The OTC design is a proof of concept for fully non-custodial swaps across two Bitcoin-derived chains, not a finished protocol product

The technical specification in [`docs/technical_specification_rod_web_swap.pdf`](docs/technical_specification_rod_web_swap.pdf) also highlights important caution areas:

- browser-native adaptor-signature math is intentionally implemented without relying on a compiled `libsecp256k1-zkp` fork
- legacy big-number code paths may expose timing-side-channel risk in browser environments
- public coordination/indexing choices create privacy and linkability tradeoffs

These are reasons to keep this project in the **experimental / testing-only** category.

## Quick start

## Run the wallet

This repository has **no root [`package.json`](package.json)** and no build step for the main application.

To run the wallet:

1. Open [`index.html`](index.html) directly in a browser, or
2. Serve the repository as static files and load [`index.html`](index.html)

Default wallet runtime assumptions:

- ROD API endpoint defaults to `https://api.spacexpanse.org:1234`
- Donation output is disabled by default
- Script-tag ordering in [`index.html`](index.html) is a compatibility requirement

## Use OTC mode

1. Open the OTC tab inside [`index.html`](index.html)
2. Configure ROD/LTC API endpoints if your environment differs from the defaults
3. If you want name operations or on-chain orderbook publication through local ROD Core RPC, run the helper described in [`tools/README.md`](tools/README.md)

For the optional helper flow, use [`tools/rod-rpc-cors-proxy.exe`](tools/rod-rpc-cors-proxy.exe) as documented in [`tools/README.md`](tools/README.md).

## Verification and proofs

### Manual/browser verification

For ordinary wallet and shell changes, load [`index.html`](index.html) in a browser and exercise the affected flow.

### OTC proof harness

The strongest current OTC verification path is the real-browser harness documented in:

- [`tests/README.md`](tests/README.md)
- [`tests/harness/README.md`](tests/harness/README.md)

That harness runs the real app in two browser contexts against mock ROD/LTC backends and a local Nostr relay, and validates broadcast transactions independently.

### Visual proof artifacts

Screenshots and proof artifacts are available under [`proof/`](proof), including:

- [`proof/active-swap-detail.jpg`](proof/active-swap-detail.jpg)
- [`proof/ltc-wallet.jpg`](proof/ltc-wallet.jpg)
- [`proof/rod-wallet.jpg`](proof/rod-wallet.jpg)

## Current limitations and caveats

- This work is a proof of concept and has **not** been cryptographically reviewed
- Live OTC success still depends on reliable API and relay behavior
- Some OTC orderbook/name operations depend on the optional local RPC/proxy path described in [`tools/README.md`](tools/README.md)
- Script-tag ordering in [`index.html`](index.html) must remain intact
- PWA shell integrity depends on keeping [`sw.js`](sw.js) aligned with actual cached assets
- ROD API response handling is tailored to the current `{result,error}` envelope behavior
- This project should be used for **testing**, not for real trading of meaningful value

## Repository structure

```text
.
├─ index.html
├─ js/
│  ├─ coin.js
│  ├─ coinbin.js
│  ├─ otc-app-ui.js
│  ├─ otc-engine.js
│  ├─ otc-nostr.js
│  └─ otc-swap.js
├─ tests/
├─ tools/
├─ docs/
├─ proof/
├─ sw.js
└─ manifest.webmanifest
```

## Further reading

- Release history and verified behavior: [`CHANGELOG.md`](CHANGELOG.md)
- Durable maintainer architecture notes: [`docs/maintainer-wiki/concept-architecture-overview.md`](docs/maintainer-wiki/concept-architecture-overview.md)
- Carbon Memory index: [`docs/maintainer-wiki/index.md`](docs/maintainer-wiki/index.md)
- Technical specification: [`docs/technical_specification_rod_web_swap.pdf`](docs/technical_specification_rod_web_swap.pdf)
- OTC proof harness: [`tests/README.md`](tests/README.md) and [`tests/harness/README.md`](tests/harness/README.md)
- Optional RPC helper: [`tools/README.md`](tools/README.md)

## Attribution

This project is derived from the browser-wallet lineage represented by [`coinbin`](README.md), but the current repository behavior should be understood through the SpaceXpanse ROD runtime, OTC modules, and repository-specific documentation linked above.

