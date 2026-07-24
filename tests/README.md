# OTC swap end-to-end proof harness

Runs the real wallet (unmodified `index.html` + `js/`) in two headless Chromium
contexts — Alice (sells ROD) and Bob (buys ROD with LTC) — against:

- a mock ROD API (`api.spacexpanse.org` shape: sats in `/unspent`, coin floats in `/transaction`),
- a mock LTC esplora (`litecoinspace.org/api` shape: sats everywhere, plain-text `POST /api/tx`),
- a real local NIP-01 Nostr relay (`ws://`).

Every broadcast transaction is **independently validated**: parsed with
bitcoinjs-lib, legacy sighash recomputed, and every P2PKH / P2SH 2-of-2
CHECKMULTISIG signature verified with noble secp256k1, plus value-balance,
dust, and (LTC) min-relay-fee checks.

## Run

```
npm install bitcoinjs-lib@6 bs58check@3 @noble/curves@1 ws@8 playwright@1
node e2e-swap-test.js                # full swap, 24 checks
RELOAD_TEST=1 node e2e-swap-test.js  # + mid-swap page reload resilience
REGRESSION=1 node e2e-swap-test.js   # patches coinjs API bases directly
```

The harness exercises a 0.05 LTC swap on purpose — any amount below 0.21 LTC
(21,000,000 sats) triggered the historical satoshi/coin unit bug.
