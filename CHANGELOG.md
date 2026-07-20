<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) SpaceXpanse contributors -->

# Changelog

All notable changes to this project will be documented in this file.

The format is inspired by Keep a Changelog and follows Semantic Versioning principles where practical.

## [2.3.0-beta] - 2026-07-19 — Trustless settlement: timelocked refunds + adaptor signatures

### Added (Critical — refund path)
- **Pre-signed timelocked refund transactions on both chains** ([`js/otc-engine.js`](js/otc-engine.js) `buildRefundTxFromFunding`, [`js/otc-app-ui.js`](js/otc-app-ui.js)): each side now PLANS its funding transaction (signs it locally, does **not** broadcast), announces the planned txid, and both parties exchange verified signatures on nLockTime refund transactions (`sequence 0xfffffffe`) **before any coin touches a chain**. Alice's ROD refund locks late (`refundRodHeight`, default +480 ROD blocks), Bob's LTC refund locks early (`ltcRefundLockHeight`, default +24 LTC blocks) — the standard atomic-swap ordering that prevents the secret holder refunding one side and claiming the other. Refund destinations derive deterministically from the swap child keys.
- **PREPARED gate**: funding broadcast is blocked until the local side holds its fully-signed refund, has countersigned the peer's refund, and has sent + verified both claim adaptor signatures. The timeline records `REFUNDS_READY → SIGNATURES_EXCHANGED → PREPARED` strictly before `ALICE_ROD_FUNDED`.
- **Automated refund monitoring**: the automation tick checks lock heights and outpoint spend status and broadcasts the pre-signed refund when a stalled swap's lock height passes. New states: `ROD_REFUND_BROADCAST`, `LTC_REFUND_BROADCAST`, `ROD_REFUNDED`, `LTC_REFUNDED`, `REFUNDED`, `PARTIALLY_SETTLED`; new messages: `swap_rod/ltc_funding_planned`, `swap_rod/ltc_refund_signature`, `swap_prepared`, `swap_rod/ltc_refund_broadcast`, `swap_refunded`. A manual "Attempt refund" button complements the automation.

### Changed (Critical — atomic settlement)
- **Settlement is now adaptor-signature based end to end** (the normal-signature exchange path is removed): Bob adaptor-signs the LTC claim and Alice adaptor-signs the ROD claim (both encrypted to Alice's adaptor point `Y`, DLEQ-verified by the receiver against a self-built claim sighash). Alice claims LTC with her signature plus Bob's **completed** adaptor signature — mathematically revealing the secret `y` on-chain. Bob recovers `y` from the real broadcast signature (Nostr evidence or, as a chain fallback, esplora `outspend`/`hex` polling), verifies `yG == Y`, completes Alice's ROD adaptor signature, and claims ROD. No party can claim without enabling the counterparty's claim.
- **Confirmation gating** (High): Bob broadcasts LTC funding only after the on-chain ROD funding **matches the planned txid** and reaches `terms.rodConfirmations`; Alice claims only after LTC funding reaches `terms.ltcConfirmations`. Esplora confirmations are now computed from the real chain tip (`/blocks/tip/height`).
- **5-field swap ID** (Medium): `swapId = SHA256(orderId | revision | sellerIdentity | buyerIdentity | termsNonce)`; the receiver verifies the binding before creating a session. Terms additionally carry identities, nonce, refund heights, confirmation counts and canonical claim/refund fees (so both sides build byte-identical sighashes).

### Fixed
- **Ghost automation locks**: per-attempt locks were persisted inside the session object, so async callbacks saving stale copies resurrected cleared locks and could stall the refund monitor for the full staleness window. Locks are now in-memory per page run; `saveExecution` merges into the freshest stored session copy.
- Out-of-order relay delivery of refund/adaptor messages can no longer deadlock the handshake: payloads are stashed and consumed by `processPendingProtocol()` from both handlers and the automation tick.
- Completed adaptor signatures now carry the SIGHASH_ALL byte required in a scriptSig.

### Verification (2026-07-19)
- E2E harness (`tests/harness/`), three scenarios against fully-validating mock chains (bitcoinjs-lib sighash + noble secp256k1, **nLockTime finality**, min-relay fee, dust):
  - **Happy path 27/27**: PREPARED before any broadcast (timeline-proven), funding txids match planned txids, pre-signed refund REJECTED as `non-final` before its lock height, LTC claim carries the completed adaptor signature, Bob's recovered secret satisfies `yG == Y`, both multisigs swept, zero normal-signature messages on the relay, zero invalid broadcasts.
  - **Refund path 21/21**: confirmation gate holds (Bob never funds at 1/3 confs), Bob disappears, chain passes `refundRodHeight`, automation broadcasts the pre-signed refund (locktime + both CHECKMULTISIG signatures independently validated), funds return to Alice, state `REFUNDED`.
  - **Reload resilience**: Alice reloads mid-swap after PREPARED; adaptor signature, signed refund and secret persist and the swap still completes.

## [Unreleased]

### Documentation
- Added concise Apache 2.0 SPDX/copyright notices to fork-specific safe-to-edit project files, while intentionally skipping original Coinb.in sources, vendored/minified or generated assets, binaries/media/fonts/PDFs, lockfiles, JSON artifacts without a safe comment strategy, and other comment-unsafe paths.

### Fixed (2026-07-18 — LTC tx creation/validation & swap workflow hardening)
- **Satoshi/coin unit handling (critical, LTC-breaking):** [`js/otc-engine.js`](js/otc-engine.js) treated any numeric amount ≤ 21,000,000 as coin-denominated and multiplied by 1e8. Esplora (litecoinspace.org) returns satoshis, so every LTC UTXO/output below 0.21 LTC was inflated 1e8-fold — LTC funding construction produced `bad-txns-in-belowout` transactions, funding verification reported "output not found", and claim amounts were astronomically wrong. Units are now explicit: UTXO and evidence values are always satoshis; `findFundingOutput()` decides by `apiType` (esplora = sats, ROD `/transaction` = Core-style coin floats); `buildClaimTxFromFunding()` prefers satoshi `value` evidence over the decimal `amount` string.
- **Nostr self-echo overwrote counterparty signatures (claim-breaking):** relays replay a client's own events (always after a reload, when the in-memory dedup cache is empty). The `swap_*_normal_signature` handlers stored the echoed local signature in the `remote*` slots, assembling a 2-of-2 scriptSig with the same signature twice — guaranteed `OP_CHECKMULTISIG` failure at broadcast. Own event IDs are now marked seen at publish time in `publishSwapMessage()`, and all signature/claim/complete handlers ignore events authored by the local Nostr pubkey.
- **Local CHECKMULTISIG pre-broadcast verification:** `buildClaim()` now verifies both claim signatures against the redeem-script pubkeys (in order) before broadcasting, and clears a stored invalid counterparty signature instead of broadcasting a transaction the network must reject.
- **Configured API endpoints were ignored:** the OTC Settings ROD/LTC API URLs were saved but never propagated to `coinjs.networks`, so all real chain calls (balance/UTXO/tx/broadcast) kept using compile-time defaults. `engine.applyApiConfig()` now applies them at engine load and on save.
- **LTC funding fee floor:** the fixed 1000-litoshi funding fee sat at Litecoin's relay floor once the tx grew past ~2 inputs. `buildFundingTx()` now estimates size and enforces ≥ 2 lit/byte (never lowering a caller-provided fee); ROD fees are unchanged.
- **Swap liveness:** each side now self-verifies its own funding output (Alice/ROD, Bob/LTC) instead of waiting for the counterparty's verified-evidence message, and a 30-second automation tick re-drives in-flight sessions, so one failed API call or missed relay message no longer strands a swap. Bob additionally funds LTC only after locally verifying the ROD funding output (`verifiedLocally` flag; remote evidence can no longer masquerade as local verification).
- **CSP blocked all Nostr relays:** `connect-src` in [`_headers`](_headers) had no `wss:` entry, so the deployed site could never open a relay WebSocket. Added `wss:`.
- **Service worker never installed:** [`sw.js`](sw.js) `cache.addAll()` referenced the removed `otc-test.html` (any 404 rejects the whole install) and omitted `js/otc-engine.js`/`js/otc-app-ui.js`. Asset list fixed, cache bumped to `v2.2.1-beta`.

### Verification (2026-07-18)
- End-to-end proof harness (Playwright, two real browser contexts as Alice/Bob, local NIP-01 relay, mock ROD API + mock esplora that fully validate every broadcast transaction with independent bitcoinjs-lib sighashes + noble secp256k1): 24/24 checks pass, including a 0.05 LTC swap (below the old 0.21 LTC unit-bug threshold), 2-of-2 P2SH CHECKMULTISIG claim validation on both chains, mid-swap page-reload resilience, and both sessions reaching `COMPLETE`. Regression run against the pre-fix code reproduces the LTC failure (`bad-txns-in-belowout (20000000 < 1999999999999000)`).

### Documentation
- Carbon Memory was refreshed after OTC codebase analysis; volatile memory now records the current OTC integration surface, indexed-source refresh inputs, follow-up verification for the missing [`otc-test.html`](otc-test.html) reference, and the latest blast-radius review across [`js/otc-engine.js`](js/otc-engine.js), [`js/otc-app-ui.js`](js/otc-app-ui.js), [`js/otc-swap.js`](js/otc-swap.js), [`sw.js`](sw.js), and [`_headers`](_headers).

### Added
- Browser OTC runtime implementation:
  - ECDSA adaptor signature helpers in [`js/ecdsa-adaptor.js`](js/ecdsa-adaptor.js).
  - Immutable ROD/LTC chain parameters in [`js/otc-chains.js`](js/otc-chains.js).
  - Versioned local storage management in [`js/otc-storage.js`](js/otc-storage.js).
  - Manual Nostr envelope handling in [`js/otc-nostr.js`](js/otc-nostr.js).
  - Swap construction, state machine, and settlement logic in [`js/otc-swap.js`](js/otc-swap.js).
  - OTC UI tab and validation harness in [`otc-test.html`](otc-test.html).
- Security hardening: OTC state persistence now automatically strips sensitive private keys (`localChildPrivateKey`, `privateKeyHex`, `privateKeyWif`, `xprv`) from backups/exports.
- PWA cache update to include new OTC assets.

### Changed
- Integrated OTC UI into [`index.html`](index.html) and updated [`css/style.css`](css/style.css) for swap-specific layouts.
- Updated [`sw.js`](sw.js) and [`_headers`](_headers) to support OTC runtime and narrow CSP helper origins.

### Verification
- OTC runtime validated via [`otc-test.html`](otc-test.html) (6/6 suites passed) and smoke-checked in main wallet UI.

### Added
- Durable maintainer-wiki ingest of the OTC swap planning documents in [`docs/maintainer-wiki/concept-otc-swap-plan.md`](docs/maintainer-wiki/concept-otc-swap-plan.md), including the Phase 1 boundary that routes ROD name operations through local ROD Core RPC while preserving ordinary chain queries and broadcasting on `api.spacexpanse.org:1234`.
- Browser OTC runtime scaffolding in [`index.html`](index.html) with new OTC modules [`js/ecdsa-adaptor.js`](js/ecdsa-adaptor.js), [`js/otc-chains.js`](js/otc-chains.js), [`js/otc-storage.js`](js/otc-storage.js), [`js/otc-nostr.js`](js/otc-nostr.js), and [`js/otc-swap.js`](js/otc-swap.js), plus the static validation harness [`otc-test.html`](otc-test.html).
- Dedicated OTC swap account derivation, deterministic terms hashing, immutable ROD/LTC chain helpers, manual Nostr envelope import/export, helper-mediated Phase 1 ROD name-operation adapter handling, strict swap-state persistence, and browser validation flows for the straight OTC implementation plan.

### Changed
- Expanded the architecture overview in [`docs/maintainer-wiki/concept-architecture-overview.md`](docs/maintainer-wiki/concept-architecture-overview.md) to distinguish current wallet runtime behavior from forward-looking OTC swap planning content in [`docs/rod-web-swap-v0.3.2.md`](docs/rod-web-swap-v0.3.2.md) and [`docs/rod-web-swap-v0.3.3.md`](docs/rod-web-swap-v0.3.3.md).
- Extended [`js/coin.js`](js/coin.js) with reusable [`coinjs.ecdsa`](js/coin.js) helpers, tagged hashing, and adaptor nonce derivation while preserving ordinary transaction-signing output paths through the existing signer.
- Updated [`sw.js`](sw.js) to cache the OTC scripts and validation harness for offline-first static testing.
- Narrowed OTC helper deployment expectations in [`_headers`](_headers) and [`index.html`](index.html:505) so the documented Phase 1 helper flow works only for same-origin or explicit local helper origins on port `11999`.

### Security
- OTC storage sanitization now strips derived child private keys and similar private signing material from [`localStorage`](js/otc-storage.js:75) backups/exports while keeping only live-page session memory in [`js/otc-swap.js`](js/otc-swap.js:161).

## [2.1.0-beta] - 2026-06-13

### Added
- Wallet tab WIF import support now lets users paste a ROD WIF private key, decode it locally, open the wallet dashboard, and use the existing balance/send/sign workflow through [`index.html`](index.html:196) and [`js/coinbin.js`](js/coinbin.js:35).

### Security
- Hardened browser entropy generation in [`js/coin.js`](js/coin.js) to rely on the CSPRNG-backed path used by the wallet runtime, preserving existing wallet compatibility while tightening client-side randomness handling.
- Added explicit risk acknowledgments in [`index.html`](index.html:204) and [`index.html`](index.html:533) for legacy Open Wallet credentials and brain-wallet style custom seeds, with enforcement in [`js/coinbin.js`](js/coinbin.js) to require user acknowledgment before sensitive deterministic wallet flows proceed.

### Changed
- Wallet send review/confirm flow now reapplies [`ensureWalletFeeMeetsRelayFloor()`](js/coinbin.js:381) before modal review and final send, prefilling the relay-minimum fee earlier and surfacing the adjustment in the confirmation modal.

### Fixed
- Wallet send confirmation modal alert colors now use readable light-surface variants for fee-floor and broadcast failure messages in [`css/style.css`](css/style.css:690).

## [2.0.2-beta] - 2026-05-28

### Added
- Wallet send reset control now has a stable selector [`#walletSendResetBtn`](index.html:375), enabling reliable reset wiring for spend-flow state restoration.

### Changed
- Wallet send-confirm modal flow now hides/disables modal send action after successful broadcast to prevent accidental duplicate submissions in [`js/coinbin.js`](js/coinbin.js:261).
- Wallet modal lifecycle now restores send controls on modal close (`hidden.bs.modal`) so a new intentional send flow can be started cleanly in [`js/coinbin.js`](js/coinbin.js:345).
- Wallet send flow now enforces a local relay-fee floor pre-check using [`estimateWalletTransactionBytes()`](js/coinbin.js:287) and [`ensureWalletFeeMeetsRelayFloor()`](js/coinbin.js:311).

### Fixed
- ROD API JSON-RPC envelope parsing now consistently unwraps `result` for balance/unspent/transaction paths in [`js/coin.js`](js/coin.js:386), [`js/coin.js`](js/coin.js:1170), and [`js/coin.js`](js/coin.js:1212).
- Broadcast error rendering now stringifies object-form API errors (e.g. `error.message`) instead of showing `[object Object]` in [`js/coin.js`](js/coin.js:1271).
- Wallet send-confirm status now differentiates success vs failure and surfaces failed signed tx recovery data in [`js/coinbin.js`](js/coinbin.js:263).
- Wallet reset action now clears spend/status state and restores send controls in [`js/coinbin.js`](js/coinbin.js:351).

## [2.0.1] - 2026-05-28

### Changed
- Wallet open flow now defaults to Legacy addresses by disabling default SegWit selection in [`index.html`](index.html:222) and [`js/coinbin.js`](js/coinbin.js:164).
- Wallet "Modern SegWit address" controls are now hidden in wallet access options in [`index.html`](index.html:221).
- Wallet receive-card address type chooser dropdown is now hidden in [`index.html`](index.html:278).

### Notes
- This release is a temporary compatibility adjustment for current API behavior that does not accept Bech32 addresses in wallet lookup flows.
- New-address generation behavior remains unchanged, including Bech32 generation controls in [`index.html`](index.html:491).

### Added
- Phase 1 PWA installability assets: [`manifest.webmanifest`](manifest.webmanifest), [`images/icon-192.png`](images/icon-192.png), [`images/icon-512.png`](images/icon-512.png), and [`images/icon-512-maskable.png`](images/icon-512-maskable.png).
- Cross-device install metadata in [`index.html`](index.html:12), including manifest link, theme color, icon links, and Apple mobile web app tags.
- ROD API server health/error checking with a visible warning cue in [`index.html`](index.html:114), [`css/style.css`](css/style.css:169), [`js/coinbin.js`](js/coinbin.js:11), and [`js/coin.js`](js/coin.js:31).

## [2.0.0] - 2026-05-27

### Added (ROD Integration)
- Wallet dashboard refresh guidance in [`index.html`](index.html:245) with supporting styles in [`css/style.css`](css/style.css:484).
- Wallet action workspace placeholder to clarify where action flows open in [`index.html`](index.html:279).

### Changed
- Major wallet UX redesign shipped across [`index.html`](index.html:168), [`css/style.css`](css/style.css:290), and [`js/coinbin.js`](js/coinbin.js:121).
- Wallet page copy now clarifies deterministic behavior: different email/passphrase combinations derive different wallets in [`index.html`](index.html:178).
- Wallet actions now anchor/scroll to the action workspace area for clearer flow in [`js/coinbin.js`](js/coinbin.js:129).
- Tab click behavior now explicitly activates Bootstrap tabs before hash updates to keep navigation state consistent in [`js/coinbin.js`](js/coinbin.js:1661).

### Fixed
- SegWit default option now remains enabled at runtime (no startup override conflict) in [`js/coinbin.js`](js/coinbin.js:133).
- Wallet label presentation now uses normal capitalization (no forced all-caps) in [`css/style.css`](css/style.css:332).
- "Need an offline address? Create one instead." now correctly switches active tab state from wallet to New Address in [`js/coinbin.js`](js/coinbin.js:1661).
- Active tab readability/contrast issues resolved in navbar/tab styling in [`css/style.css`](css/style.css:58).
- Mediator modal readability fixed by high-contrast modal surface/text/button styling in [`css/style.css`](css/style.css:105).

### Verification
- Browser verification completed for wallet open flow, action anchoring, modal readability, active tab readability, and wallet-to-New Address navigation behavior.

### ROD Migration
- Canonical chain parameter snapshot at [`docs/chainparams.0.6.9.cpp`](docs/chainparams.0.6.9.cpp).
- ROD API reference snapshot at [`docs/rod-api-root.html`](docs/rod-api-root.html).
- Persistent ROD compatibility assertions in [`test.html`](test.html).
- Memory bank documentation for project state in [`.kilocode/rules/memory-bank/`](.kilocode/rules/memory-bank/).

### Changed
- Migrated wallet network constants and behavior to SpaceXpanse ROD in [`js/coin.js`](js/coin.js).
- Updated explorer integrations to SpaceXpanse ROD Explorer in [`js/coinbin.js`](js/coinbin.js).
- Updated UI branding/content for SpaceXpanse ROD in [`index.html`](index.html) and [`README.md`](README.md).
- Updated QR/payment URI handling from `bitcoin:` to `rod:` in [`js/coinbin.js`](js/coinbin.js).
- Replaced legacy remote fee-stat dependency with local/offline deterministic fee guidance in [`js/coinbin.js`](js/coinbin.js).

### Fixed
- Normalized broadcast response handling for `{result,error,id}` API format in [`coinjs.transaction().broadcast()`](js/coin.js:1221).
- Corrected settings-reset behavior so ROD HD/network parameters are preserved in [`js/coinbin.js`](js/coinbin.js).
- Guarded donation output paths to avoid invalid/default address usage in [`js/coin.js`](js/coin.js) and [`js/coinbin.js`](js/coinbin.js).
- Fixed stale explorer link targets to official ROD explorer in [`js/coinbin.js`](js/coinbin.js).
- Removed debug artifact from test flow in [`test.html`](test.html).

### Security
- Removed active legacy Chainquery SQL request construction from runtime wallet API flow by moving to direct ROD API integration in [`js/coin.js`](js/coin.js).

### Verification
- Browser-compatible ROD validation matrix completed (16/16 passing).
- Final smoke verification after cleanup completed (13/13 passing).

### Notes
- Public API endpoint now uses `https://api.spacexpanse.org:1234` in [`js/coin.js`](js/coin.js).
