# E2E swap proof harness

Runs the REAL wallet app in two headless Chromium contexts (Alice + Bob) against
mock ROD/esplora APIs that independently validate every broadcast transaction
(bitcoinjs-lib sighash + noble secp256k1, nLockTime finality, min-relay fee,
dust) and a real local NIP-01 Nostr relay.

    npm install            # playwright, bitcoinjs-lib, @noble/curves, bs58check, ws
    APP_DIR=/path/to/app SCENARIO=happy  node e2e-swap-test.js
    APP_DIR=/path/to/app SCENARIO=refund node e2e-swap-test.js
    APP_DIR=/path/to/app SCENARIO=happy RELOAD_TEST=1 node e2e-swap-test.js

Reports are written to e2e-report-<scenario>.json.
