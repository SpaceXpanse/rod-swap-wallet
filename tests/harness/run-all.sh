#!/usr/bin/env bash
# Full proof matrix: in-browser unit checks, then every swap scenario on every
# supported counter chain, then mid-swap reload resilience.
#
#   ./run-all.sh
#
# Each e2e run writes tests/harness/e2e-report-<chain>-<scenario>.json.
set -u
cd "$(dirname "$0")"

FAILED=0
RESULTS=()
NODE_BIN="${NODE_BIN:-}"

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

run() {
  local label="$1"; shift
  echo ""
  echo "=============================================================="
  echo ">>> $label"
  echo "=============================================================="
  env "$@" "$NODE_BIN" e2e-swap-test.js 2>&1 | grep -v 'console.error'
  record "$label" "${PIPESTATUS[0]}"
}

echo "=============================================================="
echo ">>> unit: chain layer, policy, fees, invariants"
echo "=============================================================="
"$NODE_BIN" unit-browser-test.js
record "unit: chain layer, policy, fees, invariants" $?

for CHAIN in LTC DOGE BTC BCH; do
  run "e2e $CHAIN happy path"        ALT_CHAIN=$CHAIN SCENARIO=happy
  run "e2e $CHAIN ROD-leg refund"    ALT_CHAIN=$CHAIN SCENARIO=refund
  run "e2e $CHAIN alt-leg refund"    ALT_CHAIN=$CHAIN SCENARIO=altrefund
done

run "e2e LTC happy + mid-swap reload"  ALT_CHAIN=LTC SCENARIO=happy RELOAD_TEST=1
run "e2e DOGE happy + mid-swap reload" ALT_CHAIN=DOGE SCENARIO=happy RELOAD_TEST=1
run "e2e BTC happy + mid-swap reload"  ALT_CHAIN=BTC SCENARIO=happy RELOAD_TEST=1
run "e2e BCH happy + mid-swap reload"  ALT_CHAIN=BCH SCENARIO=happy RELOAD_TEST=1

echo ""
echo "=============================================================="
echo ">>> PROOF MATRIX"
echo "=============================================================="
for r in "${RESULTS[@]}"; do echo "$r"; done
echo "--------------------------------------------------------------"
if [ "$FAILED" -eq 0 ]; then
  echo "ALL SUITES PASSED"
else
  echo "SOME SUITES FAILED"
fi
exit "$FAILED"
