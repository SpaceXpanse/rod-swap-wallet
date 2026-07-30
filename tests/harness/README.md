# Real-browser settlement harness

The harness runs the actual static wallet in isolated Chromium contexts against
local mock ROD and counter-chain APIs plus a local NIP-01 relay. Production
application files are not replaced by test doubles.

Every broadcast is parsed and independently checked with `bitcoinjs-lib` and
`@noble/curves`: prevouts, signatures, sighash type, 2-of-2 CHECKMULTISIG
ordering, value conservation, dust, relay/mining fee, `nLockTime`, and
pre-finality rejection are verified outside the wallet code that created the
transaction.

The matrix uses the same refund delays, confirmation counts, and canonical
fees as the shipped production defaults. The fast release gate fails if those
values drift. Unexpected page errors, failed requests, and HTTP failures fail
the scenario; the only allowed 404 is the deliberate pre-index transaction
probe used by settlement polling.

Before a settlement scenario starts, the harness proves that Alice and Bob
have independent browser storage, wallet identities, swap xpubs, Nostr keys,
and empty session stores. Chromium `--single-process` mode is rejected by the
two-peer settlement runner because it invalidates that isolation; the
single-context shell/PWA gate can still run in that mode. The pre-funding handshake uses separate,
role-aware deadlines for readiness, adaptor commitment, funding plans, refund
signatures, adaptor signatures, local PREPARED, and remote PREPARED. A timeout
report names the exact missing prerequisites and includes pending signature
slots plus relay event counts grouped by message type and signer.

## Run

```bash
npm ci
npx playwright install --with-deps chromium
bash run-all.sh
```

Useful controls:

- `FAST_ONLY=1 bash run-all.sh` — Node-only contracts and mutations.
- `SKIP_MUTATIONS=1 bash run-all.sh` — avoid repeating mutations after a
  separate fast-gate job.
- `ALT_CHAIN=LTC SCENARIO=happy node e2e-swap-test.js` — one scenario.
- `ALT_CHAIN=DOGE SCENARIO=altrefund node e2e-swap-test.js` — DOGE refund.
- `RELOAD_TEST=1` with `SCENARIO=happy` — mid-swap persistence/replay.
- `DOGE_ROD_REFUND_REPEATS=5 bash run-all.sh` — run the complete matrix and
  require five total passes of the historically flaky DOGE ROD-refund case
  (default: 3, maximum: 20).
- `PROTOCOL_STAGE_TIMEOUT_MS=60000` — change each pre-funding stage deadline
  without returning to one opaque aggregate timeout.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium` — use a preinstalled
  browser.
- `PLAYWRIGHT_CHROMIUM_ARGS_JSON='["--flag"]'` — pass host-specific launch
  flags when a custom browser binary requires them. `--single-process` remains
  forbidden for the two-peer settlement runner, but the single-context
  shell/PWA gate in [`tests/harness/unit-browser-test.js`](unit-browser-test.js)
  may still run under it.

## Recovery and reload notes

- [`tests/harness/unit-browser-test.js`](unit-browser-test.js) now checks that
  the OTC Settings export/import buttons restore a real live swap, resubscribe
  tracking, render the swap list, and surface the expected success flash.
- [`tests/harness/e2e-swap-test.js`](e2e-swap-test.js) records expected
  reload-time `net::ERR_ABORTED` events separately from genuine browser issues.
  Only the transient local ROD `/info` health probe is allowed to abort during
  the deliberate reload scenario; every other failed request still fails the
  release gate.

`run-all.sh` is deliberately sequential. The mock servers use fixed ports and
the swap automation is timing-sensitive; parallel cases would create harness
contention rather than useful product load.
