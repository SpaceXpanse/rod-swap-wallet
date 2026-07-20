<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) SpaceXpanse contributors -->

# AGENTS.md

This file provides guidance to agents when working with code in this repository.

- This repo is a static browser wallet: there is no [`package.json`](package.json) and no scripted build/lint/test entrypoint. Validate changes by loading [`index.html`](index.html) in a browser and exercising the affected flow.
- Runtime depends on script-tag order in [`index.html`](index.html): crypto/libs load before [`js/coin.js`](js/coin.js), and [`js/coin.js`](js/coin.js) loads before [`js/coinbin.js`](js/coinbin.js). Do not convert to deferred/reordered loading without rechecking all globals.
- Network defaults are hard-coded for ROD in [`js/coin.js`](js/coin.js): mainnet prefixes, Bech32 HRP `rod`, and API base `https://api.spacexpanse.org:1234`. Wallet/explorer behavior assumes these defaults unless the Settings tab changes them at runtime.
- The wallet is intentionally offline-first but not fully offline: address generation/signing are local, while balance, UTXO, tx lookup, broadcast, and API health depend on the ROD API wrappers in [`coinjs.addressBalance()`](js/coin.js:419), [`coinjs.transaction().listUnspent()`](js/coin.js:1197), [`coinjs.transaction().getTransaction()`](js/coin.js:1239), and [`coinjs.transaction().broadcast()`](js/coin.js:1322).
- Broadcast and lookup handlers expect JSON-RPC-style `{result,error}` envelopes from the ROD API, not legacy Coinb.in/Chain.so payloads; preserve that normalization when editing API code.
- Wallet login compatibility is deliberate: deterministic open-wallet derivation in [`#openBtn`](js/coinbin.js:137) must remain stable for existing users, even though the flow is labeled less secure.
- SegWit support is intentionally split: new-address tools expose SegWit/Bech32, but the wallet access flow hides those controls in [`index.html`](index.html) and forces legacy by default in [`syncWalletSegwitState()`](js/coinbin.js:250) startup wiring for current API compatibility.
- Fee guidance is local-only in this fork. Keep the relay-floor logic centered on [`ensureWalletFeeMeetsRelayFloor()`](js/coinbin.js:463) and the offline estimate in [`feeStats()`](js/coinbin.js:2369); do not reintroduce remote fee estimators.
- Developer donation is intentionally disabled by default: [`coinjs.developer`](js/coin.js:22) is empty and [`#developerDonation`](index.html) defaults to `0`. Guard any donation-related change against emitting invalid outputs.
- Be careful when changing scripts or assets used by the PWA shell: update the cache list in [`sw.js`](sw.js) and keep CSP/connect restrictions aligned in [`_headers`](_headers).
- Existing project history in [`CHANGELOG.md`](CHANGELOG.md) is the best source for non-obvious compatibility constraints and previously verified wallet behavior.
