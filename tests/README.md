# Wallet and OTC proof gates

The test system has two layers. Both are release gates; neither contacts a live
chain or spends funds.

## Fast deterministic gate

Run from the repository root:

```bash
bash tests/run-fast.sh
```

This needs Node.js only and covers:

- release integrity: missing assets, JavaScript syntax, script order, merge
  markers, SHA-256 inventory, version identity, service-worker completeness,
  CSP/API alignment, duplicate selector IDs, support-registry drift, and
  agreement between production refund/confirmation/fee policy and the browser
  settlement matrix;
- explorer contracts: Esplora, BlockCypher, Blockchair, and Blockbook response
  normalization, malformed responses, broadcast shapes, request coalescing,
  and retry isolation after failure;
- protocol adversarial cases: unsigned/tampered Nostr events, signer-to-ROD
  binding, canonical terms mismatch, refund-order timing and boundary cases,
  and bilateral DOGE reconstruction;
- wallet races: DGB → ROD/LTC switching, address changes, late callbacks,
  DGB default migration, and custom-endpoint preservation;
- negative controls: seven deliberate blocker mutations must make the relevant
  tests fail. A suite that still passes after its guard is removed is itself
  considered broken.

Use `SKIP_MUTATIONS=1` only for a quick local edit loop. CI runs mutations.

## Full browser and settlement gate

Install the pinned dependencies and Chromium:

```bash
cd tests/harness
npm ci
npx playwright install --with-deps chromium
bash run-all.sh
```

In addition to the fast gate, this loads the unmodified `index.html` in real
Chromium, checks browser globals and DOM wiring, installs the service worker,
reloads the full shell offline, and runs two peers through the independently
validated settlement matrix for every chain in the shipped OTC registry.

The browser-side gate is intentionally split:

- [`tests/harness/unit-browser-test.js`](harness/unit-browser-test.js) is a
  single-context shell/PWA and OTC-settings invariant check. It can still run
  when host Chromium requires `--single-process`.
- [`tests/harness/e2e-swap-test.js`](harness/e2e-swap-test.js) is the two-peer
  settlement proof. It rejects `--single-process` because Alice/Bob storage and
  identity isolation are protocol evidence there.

The current matrix is LTC and DOGE:

- happy settlement;
- seller/ROD-leg refund;
- buyer/counter-leg refund;
- mid-swap reload and recovery, including persistence of signed refunds and the
  only allowed deliberate reload-time abort of the transient local ROD health
  probe.

[`tests/security-regression.js`](security-regression.js) now also proves the OTC
recovery export/import boundary: exports must exclude raw wallet/adaptor/Nostr
secrets and local RPC credentials, imports must reject tampering and unexpected
blob keys, and partial storage-write failures must roll back to the prior local
state.

BTC, BCH, and DGB remain wallet-only in this release. The release gate requires
the OTC definitions, fee table, engine defaults, e2e registry, UI selector, and
matrix runner to agree, so a future chain cannot be half-added.

Reports are written as `tests/harness/e2e-report-<chain>-<scenario>.json`.
Failed scenarios write the same report before exiting, including page/session
diagnostics and unexpected browser console, request, and HTTP errors.
