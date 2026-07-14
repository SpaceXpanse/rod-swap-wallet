# Changelog

All notable changes to this project will be documented in this file.

The format is inspired by Keep a Changelog and follows Semantic Versioning principles where practical.

## [Unreleased]

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
