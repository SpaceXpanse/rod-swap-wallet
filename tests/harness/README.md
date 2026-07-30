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
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium` — use a preinstalled
  browser.
- `PLAYWRIGHT_CHROMIUM_ARGS_JSON='["--flag"]'` — pass host-specific launch
  flags when a custom browser binary requires them.

`run-all.sh` is deliberately sequential. The mock servers use fixed ports and
the swap automation is timing-sensitive; parallel cases would create harness
contention rather than useful product load.
