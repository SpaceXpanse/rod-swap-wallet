#!/usr/bin/env bash
# Complete release gate:
#   1. deterministic Node contract/security/release/mutation checks
#   2. real-browser integration + offline PWA check
#   3. independently validated settlement matrix for every OTC counter chain
set -u
set -o pipefail
cd "$(dirname "$0")"

FAILED=0
RESULTS=()
NODE_BIN="${NODE_BIN:-}"
SUPPORTED_SWAP_CHAINS=(LTC DOGE)

if [ -z "$NODE_BIN" ]; then
  if command -v node >/dev/null 2>&1; then
    NODE_BIN="$(command -v node)"
  elif command -v node.exe >/dev/null 2>&1; then
    NODE_BIN="$(command -v node.exe)"
  else
    echo "node not found in PATH; set NODE_BIN to a Node executable"
    exit 127
  fi
fi

record() {
  local label="$1" code="$2"
  if [ "$code" -eq 0 ]; then
    RESULTS+=("PASS  $label")
  else
    RESULTS+=("FAIL  $label")
    FAILED=1
  fi
}

run_node() {
  local label="$1" script="$2"
  shift 2
  echo ""
  echo "=============================================================="
  echo ">>> $label"
  echo "=============================================================="
  env "$@" "$NODE_BIN" "$script"
  record "$label" "$?"
}

run_e2e() {
  local label="$1"
  shift
  echo ""
  echo "=============================================================="
  echo ">>> $label"
  echo "=============================================================="
  env "$@" "$NODE_BIN" e2e-swap-test.js
  record "$label" "$?"
}

run_node "release/package integration contracts" ../release-gate.js
run_node "explorer API contracts and failure isolation" ../explorer-contract.js
run_node "security and protocol adversarial regressions" ../security-regression.js
run_node "wallet balance/network-switch races" ../wallet-balance-race.js
if [ "${SKIP_MUTATIONS:-0}" != "1" ]; then
  run_node "negative controls: blocker mutations must be killed" ../mutation-gate.js
fi

if [ "${FAST_ONLY:-0}" = "1" ]; then
  echo ""
  echo "FAST_ONLY=1: browser and settlement matrix skipped"
else
  if [ ! -d node_modules ]; then
    echo ""
    echo "tests/harness/node_modules is missing; run npm ci in tests/harness"
    record "browser dependency preflight" 1
  else
    run_node "real-browser wiring + offline PWA shell" unit-browser-test.js

    for CHAIN in "${SUPPORTED_SWAP_CHAINS[@]}"; do
      run_e2e "e2e $CHAIN happy path"       ALT_CHAIN="$CHAIN" SCENARIO=happy
      run_e2e "e2e $CHAIN ROD-leg refund"   ALT_CHAIN="$CHAIN" SCENARIO=refund
      run_e2e "e2e $CHAIN alt-leg refund"   ALT_CHAIN="$CHAIN" SCENARIO=altrefund
      run_e2e "e2e $CHAIN reload recovery"  ALT_CHAIN="$CHAIN" SCENARIO=happy RELOAD_TEST=1
    done
  fi
fi

echo ""
echo "=============================================================="
echo ">>> PROOF MATRIX"
echo "=============================================================="
for result in "${RESULTS[@]}"; do echo "$result"; done
echo "--------------------------------------------------------------"
if [ "$FAILED" -eq 0 ]; then
  echo "ALL REQUESTED SUITES PASSED"
else
  echo "ONE OR MORE REQUIRED SUITES FAILED"
fi
exit "$FAILED"
