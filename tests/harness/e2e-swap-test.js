/*
 * End-to-end ROD↔LTC OTC swap proof — v2 (refunds + adaptor settlement).
 *
 * Runs the REAL wallet app (unmodified index.html + js/) in two headless
 * Chromium contexts — Alice (sells ROD, holds the adaptor secret) and Bob
 * (buys ROD with LTC) — wired to mock chain APIs that INDEPENDENTLY validate
 * every broadcast transaction (bitcoinjs-lib sighash + noble secp256k1,
 * nLockTime finality, min-relay fees, dust) and a real local NIP-01 relay.
 *
 * SCENARIO=happy (default):
 *   1. In-page OTC validation suites pass.
 *   2. Both sides PLAN (sign, don't broadcast) funding, exchange pre-signed
 *      timelocked refunds, exchange VERIFIED adaptor signatures → PREPARED.
 *   3. Alice's fully-signed ROD refund is REJECTED as non-final before its
 *      lock height (proves the timelock actually protects the funds).
 *   4. Timeline proves PREPARED came before any funding broadcast.
 *   5. ROD funding txid matches the planned txid; confirmations gated.
 *   6. Alice claims LTC with her sig + Bob's COMPLETED adaptor signature.
 *   7. Bob recovers the adaptor secret FROM THE REAL SIGNATURE, verifies it
 *      against the adaptor point, and claims ROD with Alice's completed sig.
 *   8. Zero normal-signature messages on the relay (settlement is atomic).
 *   9. Both sessions COMPLETE; money lands at the payout addresses.
 *
 * SCENARIO=refund:
 *   1. Runs through PREPARED; Alice broadcasts ROD funding.
 *   2. Bob requires 3 ROD confirmations (mock height frozen → he never funds
 *      LTC — proves the confirmation gate) and then disappears.
 *   3. Alice's refund is rejected as non-final before the lock height.
 *   4. Mock chain advances past refundRodHeight → Alice's automation
 *      broadcasts the pre-signed refund; the mock validates locktime + both
 *      CHECKMULTISIG signatures; funds return to Alice; state = REFUNDED.
 *
 * RELOAD_TEST=1 (with SCENARIO=happy): reloads Alice after PREPARED and
 * requires the swap to still complete (persistence + relay replay).
 */
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const { MockChain, rodApiServer, esploraServer, nostrRelay, staticServer } = require('./mock-infra');

const APP_DIR = process.env.APP_DIR || path.resolve('/root/work/baseline');
const SCENARIO = process.env.SCENARIO || 'happy';
const PORTS = { app: 9300, rod: 9301, ltc: 9302, relay: 9303 };
const ROD_AMOUNT = '100.00000000';
const LTC_AMOUNT = '0.05000000'; // < 0.21 LTC guards the historical unit bug
const START_HEIGHT = 500000;
const RELEASE_HEIGHT = 500002;
const REFUND_ROD_BLOCKS = 30;   // refundRodHeight = 500030
const LTC_REFUND_BLOCKS = 40;   // ltcRefundLockHeight = 500040
const ROD_CLAIM_FEE = 51900;
const LTC_CLAIM_FEE = 1000;
const ROD_REFUND_FEE = 51900;

const results = { steps: [], ok: true };
function step(name, ok, detail) {
  results.steps.push({ name, ok, detail: detail || '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) results.ok = false;
}

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('Timeout waiting for: ' + label);
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function main() {
  const rodChain = new MockChain('ROD');
  const ltcChain = new MockChain('LTC');
  rodChain.height = START_HEIGHT;
  ltcChain.height = START_HEIGHT;
  await rodApiServer(rodChain, PORTS.rod);
  await esploraServer(ltcChain, PORTS.ltc);
  const relay = nostrRelay(PORTS.relay);
  await staticServer(APP_DIR, PORTS.app);
  console.log(`mock servers up · scenario=${SCENARIO} · app=${APP_DIR}`);

  const rodConfirmationsCfg = SCENARIO === 'refund' ? 3 : 1;

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const mkContext = async (label) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.addInitScript(({ rodPort, ltcPort, relayPort, rodConfs }) => {
      localStorage.setItem('rodOtcEngineConfig', JSON.stringify({
        rodApiUrl: 'http://127.0.0.1:' + rodPort,
        ltcApiUrl: 'http://127.0.0.1:' + ltcPort + '/api',
        relays: ['ws://127.0.0.1:' + relayPort],
        releaseBlocks: 2,
        refundRodBlocks: 30,
        ltcRefundBlocks: 40,
        rodConfirmations: rodConfs,
        ltcConfirmations: 1,
        tickMs: 1500
      }));
    }, { rodPort: PORTS.rod, ltcPort: PORTS.ltc, relayPort: PORTS.relay, rodConfs: rodConfirmationsCfg });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') console.log(`[${label} console.error] ${m.text()}`);
    });
    page.on('pageerror', (e) => console.log(`[${label} pageerror] ${e.message}`));
    await page.goto(`http://127.0.0.1:${PORTS.app}/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.rodOtc && window.rodOtc.engine && window.jQuery);
    return page;
  };

  const alice = await mkContext('alice');
  const bob = await mkContext('bob');

  const mkWallet = (page) => page.evaluate(() => {
    coinjs.setNetwork('ROD');
    const prevCompressed = coinjs.compressed;
    coinjs.compressed = true;
    const keys = coinjs.newKeys();
    coinjs.compressed = prevCompressed;
    $('#walletKeys .privkey').val(keys.wif);
    $('#walletKeys .pubkey').val(keys.pubkey);
    $('#walletAddress').text(keys.address);
    const prevNet = coinjs.activeNetwork;
    coinjs.setNetwork('LTC');
    const ltcAddress = coinjs.wif2address(keys.wif).address;
    coinjs.setNetwork(prevNet || 'ROD');
    return { address: keys.address, ltcAddress, pubkey: keys.pubkey, wif: keys.wif };
  });
  const setWallet = (page, wallet) => page.evaluate((w) => {
    $('#walletKeys .privkey').val(w.wif);
    $('#walletKeys .pubkey').val(w.pubkey);
    $('#walletAddress').text(w.address);
    return true;
  }, wallet);
  const aliceWallet = await mkWallet(alice);
  const bobWallet = await mkWallet(bob);
  console.log('alice ROD addr', aliceWallet.address, '| bob ROD addr', bobWallet.address, '| bob LTC addr', bobWallet.ltcAddress);

  rodChain.credit(aliceWallet.address, 2000 * 1e8);
  ltcChain.credit(bobWallet.ltcAddress, Math.round(0.2 * 1e8));
  ltcChain.credit(bobWallet.ltcAddress, Math.round(0.03 * 1e8));

  for (const [label, page] of [['alice', alice], ['bob', bob]]) {
    const suite = await page.evaluate(() => rodOtc.validation.runAll());
    step(`${label}: in-page OTC validation suite`, !!suite.passed,
      suite.results.map((r) => `${r.name}:${r.passed ? 'ok' : 'FAIL'}`).join(', '));
  }

  for (const page of [alice, bob]) {
    await page.evaluate(() => { $('a[href="#otc"]').tab('show'); });
  }
  await waitFor(async () => {
    const a = await alice.evaluate(() => rodOtc.engine.pool && rodOtc.engine.pool.count());
    const b = await bob.evaluate(() => rodOtc.engine.pool && rodOtc.engine.pool.count());
    return a >= 1 && b >= 1;
  }, 15000, 'both pages connected to local Nostr relay');
  step('both pages connected to local Nostr relay', true);

  await waitFor(() => alice.evaluate(() => $('#nsMyXpub').val() ? true : false), 15000, 'alice swap xpub');
  await waitFor(() => bob.evaluate(() => $('#nsMyXpub').val() ? true : false), 15000, 'bob swap xpub');
  const bobXpub = await bob.evaluate(() => $('#nsMyXpub').val());
  step('swap accounts derived (both)', !!bobXpub, 'bob xpub ' + bobXpub.slice(0, 12) + '…');

  // ---- Alice creates & starts the swap ----
  await alice.evaluate(({ rod, ltc, peerXpub, peerRodPayout, release }) => {
    $('#nsRole').val('alice');
    $('#nsRod').val(rod);
    $('#nsLtc').val(ltc);
    $('#nsRelease').val(String(release));
    $('#nsPeer').val('bob-e2e-test');
    $('#nsPeerXpub').val(peerXpub);
    $('#nsPeerPayoutAddr').val(peerRodPayout);
    $('#nsCreate').click();
  }, { rod: ROD_AMOUNT, ltc: LTC_AMOUNT, peerXpub: bobXpub, peerRodPayout: bobWallet.address, release: RELEASE_HEIGHT });

  const swapId = await waitFor(() => alice.evaluate(() => $('#nsSwapId').val() || null), 20000, 'alice swap created');
  step('alice created swap session', !!swapId, 'swapId ' + swapId.slice(0, 16) + '…');

  // terms carry the refund protocol fields
  const termsCheck = await alice.evaluate((id) => {
    const s = rodOtc.engine.restoreLive(id);
    return {
      refundRodHeight: s.terms.refundRodHeight,
      ltcRefundLockHeight: s.terms.ltcRefundLockHeight,
      rodConfirmations: s.terms.rodConfirmations,
      ltcConfirmations: s.terms.ltcConfirmations,
      sellerRodRefundAddress: s.terms.sellerRodRefundAddress,
      buyerLtcRefundAddress: s.terms.buyerLtcRefundAddress,
      nonce: s.terms.termsNonce
    };
  }, swapId);
  step('terms include refund heights + confirmations + 5-field swapId nonce',
    termsCheck.refundRodHeight === START_HEIGHT + REFUND_ROD_BLOCKS &&
    termsCheck.ltcRefundLockHeight === START_HEIGHT + LTC_REFUND_BLOCKS &&
    termsCheck.rodConfirmations === rodConfirmationsCfg &&
    !!termsCheck.sellerRodRefundAddress && !!termsCheck.buyerLtcRefundAddress && !!termsCheck.nonce,
    JSON.stringify(termsCheck));

  await waitFor(() => bob.evaluate((id) => {
    const all = rodOtc.engine.loadLive();
    return all[id] ? true : null;
  }, swapId), 30000, 'bob auto-created session from swap_terms');
  step('bob auto-created session from incoming terms', true);

  const accept = (page) => page.evaluate((id) => {
    const card = $('.otc-swap-card[data-id="' + id + '"]');
    if (card.length) card.trigger('click');
    $('.otcExecBtn[data-action="accept-offer"]').trigger('click');
    return rodOtc.engine.restoreLive(id).localAccepted === true;
  }, swapId);
  step('bob accepted', await accept(bob));
  step('alice accepted', await accept(alice));

  // ---- pre-funding pipeline → PREPARED on both, with NOTHING broadcast ----
  await waitFor(() => alice.evaluate((id) => {
    const s = rodOtc.engine.restoreLive(id);
    return (s && s.rodRefund && s.rodRefund.signedHex && s.localRodAdaptorSignature && s.remoteLtcAdaptorSignature && s.localPrepared) ? true : null;
  }, swapId), 90000, 'alice PREPARED (refund signed + adaptor sigs verified)');
  await waitFor(() => bob.evaluate((id) => {
    const s = rodOtc.engine.restoreLive(id);
    return (s && s.ltcRefund && s.ltcRefund.signedHex && s.localLtcAdaptorSignature && s.remoteRodAdaptorSignature && s.localPrepared) ? true : null;
  }, swapId), 90000, 'bob PREPARED (refund signed + adaptor sigs verified)');
  step('both sides PREPARED: planned fundings, pre-signed refunds, verified adaptor signatures', true);

  const aliceRefund = await alice.evaluate((id) => {
    const s = rodOtc.engine.restoreLive(id);
    return { signedHex: s.rodRefund.signedHex, lockHeight: s.rodRefund.lockHeight, plannedTxid: s.plannedRodFunding.txid };
  }, swapId);
  const bobRefund = await bob.evaluate((id) => {
    const s = rodOtc.engine.restoreLive(id);
    return { signedHex: s.ltcRefund.signedHex, lockHeight: s.ltcRefund.lockHeight, plannedTxid: s.plannedLtcFunding.txid };
  }, swapId);
  step('refund locktimes match terms',
    aliceRefund.lockHeight === START_HEIGHT + REFUND_ROD_BLOCKS && bobRefund.lockHeight === START_HEIGHT + LTC_REFUND_BLOCKS,
    `ROD refund locks at ${aliceRefund.lockHeight}, LTC refund locks at ${bobRefund.lockHeight}`);

  if (SCENARIO === 'happy') {
    await runHappyPath();
  } else {
    await runRefundPath();
  }

  const fs = require('fs');
  fs.writeFileSync(`/root/work/harness/e2e-report-${SCENARIO}.json`, JSON.stringify({
    scenario: SCENARIO,
    swapId,
    steps: results.steps,
    rodBroadcasts: rodChain.broadcasts,
    ltcBroadcasts: ltcChain.broadcasts,
    relayEventTypes: relay.events.map((e) => {
      try { return JSON.parse(e.content).type; } catch (err) { return 'unknown'; }
    })
  }, null, 2));

  await browser.close();
  console.log('\n================= RESULT =================');
  console.log(results.ok ? 'ALL CHECKS PASSED ✓' : 'FAILURES PRESENT ✗');
  process.exit(results.ok ? 0 : 1);

  /* ================= happy path ================= */
  async function runHappyPath() {
    // ROD funding must appear AND match the planned txid
    await waitFor(() => rodChain.broadcasts.length > 0 || null, 60000, 'ROD funding broadcast');
    const rodFundingB = rodChain.broadcasts[0];
    step('ROD funding tx broadcast & independently validated', rodFundingB.valid, rodFundingB.details.join(' | '));
    step('ROD funding txid equals PLANNED txid (refunds/adaptor sigs bind to it)', rodFundingB.txid === aliceRefund.plannedTxid,
      `${rodFundingB.txid.slice(0, 16)}… vs planned ${aliceRefund.plannedTxid.slice(0, 16)}…`);

    // Alice's refund must be REJECTED before its lock height (direct probe;
    // rejection is NOT recorded as a broadcast attempt)
    const probe = rodChain.validateAndAccept(aliceRefund.signedHex);
    step('pre-signed ROD refund rejected as non-final before lock height',
      !probe.ok && /non-final/.test(probe.error || ''), probe.error || 'UNEXPECTEDLY ACCEPTED');

    // timeline ordering: PREPARED strictly before ALICE_ROD_FUNDED
    const timeline = await alice.evaluate((id) => (rodOtc.engine.restoreLive(id).timeline || []).map((t) => t.state), swapId);
    const preparedIdx = timeline.indexOf('PREPARED');
    const fundedIdx = timeline.indexOf('ALICE_ROD_FUNDED');
    step('timeline: PREPARED precedes ROD funding broadcast', preparedIdx !== -1 && fundedIdx !== -1 && preparedIdx < fundedIdx,
      timeline.join(' → '));

    await waitFor(() => ltcChain.broadcasts.length > 0 || null, 120000, 'LTC funding broadcast');
    const ltcFundingB = ltcChain.broadcasts[0];
    step('LTC funding tx broadcast & independently validated (0.05 LTC < 0.21 LTC)', ltcFundingB.valid, ltcFundingB.details.join(' | '));
    step('LTC funding txid equals PLANNED txid', ltcFundingB.txid === bobRefund.plannedTxid);

    if (process.env.RELOAD_TEST === '1') {
      await alice.reload({ waitUntil: 'load' });
      await alice.waitForFunction(() => window.rodOtc && window.rodOtc.engine && window.jQuery);
      await setWallet(alice, aliceWallet);
      await alice.evaluate(() => { $('a[href="#otc"]').tab('show'); });
      await waitFor(() => alice.evaluate(() => (rodOtc.engine.pool && rodOtc.engine.pool.count() >= 1) || null), 15000, 'alice relay reconnect after reload');
      const persisted = await alice.evaluate((id) => {
        const s = rodOtc.engine.restoreLive(id);
        return !!(s && s.remoteLtcAdaptorSignature && s.rodRefund && s.rodRefund.signedHex && s.adaptorSecret);
      }, swapId);
      step('after reload: adaptor sig, refund and secret persisted', persisted);
    }

    // release the claim height gate
    rodChain.height = RELEASE_HEIGHT + 1;

    await waitFor(() => ltcChain.broadcasts.length > 1 || null, 120000, 'LTC claim broadcast');
    const ltcClaimB = ltcChain.broadcasts[1];
    step('LTC claim tx (2-of-2 P2SH, completed adaptor sig) broadcast & independently validated', ltcClaimB.valid, ltcClaimB.details.join(' | '));

    // Bob recovers the secret FROM THE REAL SIGNATURE
    await waitFor(() => bob.evaluate((id) => {
      const s = rodOtc.engine.restoreLive(id);
      return s && s.recoveredAdaptorSecret ? true : null;
    }, swapId), 90000, 'bob recovered adaptor secret');
    const recovery = await bob.evaluate((id) => {
      const s = rodOtc.engine.restoreLive(id);
      return {
        matchesPoint: coinjs.adaptor.publicKey(s.recoveredAdaptorSecret) === s.adaptorPoint,
        state: s.state
      };
    }, swapId);
    step('recovered secret verifies against adaptor point (yG == Y)', recovery.matchesPoint, 'state ' + recovery.state);

    await waitFor(() => rodChain.broadcasts.length > 1 || null, 90000, 'ROD claim broadcast');
    const rodClaimB = rodChain.broadcasts[1];
    step('ROD claim tx (2-of-2 P2SH, completed adaptor sig) broadcast & independently validated', rodClaimB.valid, rodClaimB.details.join(' | '));

    const bobState = await waitFor(() => bob.evaluate((id) => {
      const s = rodOtc.engine.restoreLive(id);
      return s && s.state === 'COMPLETE' ? s.state : null;
    }, swapId), 60000, 'bob COMPLETE');
    step('bob session COMPLETE', bobState === 'COMPLETE');
    const aliceState = await waitFor(() => alice.evaluate((id) => {
      const s = rodOtc.engine.restoreLive(id);
      return s && s.state === 'COMPLETE' ? s.state : null;
    }, swapId), 60000, 'alice COMPLETE');
    step('alice session COMPLETE', aliceState === 'COMPLETE', aliceState);

    // money flow: payout addresses from terms (wallet addresses, not child keys)
    const dests = await alice.evaluate((id) => {
      const s = rodOtc.engine.restoreLive(id);
      return {
        sellerLtcPayout: s.terms.sellerLtcPayoutAddress,
        buyerRodPayout: s.terms.buyerRodPayoutAddress,
        ltcMultisig: s.terms.ltcFunding.multisigAddress,
        rodMultisig: s.terms.rodFunding.multisigAddress
      };
    }, swapId);
    const aliceGotLtc = ltcChain.balance(dests.sellerLtcPayout);
    const bobGotRod = rodChain.balance(dests.buyerRodPayout);
    step('alice received LTC at her payout address', aliceGotLtc === Math.round(0.05 * 1e8) - LTC_CLAIM_FEE,
      `${aliceGotLtc} sats at ${dests.sellerLtcPayout}`);
    step('bob received ROD at his payout address', bobGotRod === Math.round(100 * 1e8) - ROD_CLAIM_FEE,
      `${bobGotRod} sats at ${dests.buyerRodPayout}`);
    step('LTC multisig fully swept', ltcChain.balance(dests.ltcMultisig) === 0);
    step('ROD multisig fully swept', rodChain.balance(dests.rodMultisig) === 0);

    // atomicity proof: NO normal-signature messages were ever needed
    const relayTypes = relay.events.map((e) => { try { return JSON.parse(e.content).type; } catch (err) { return ''; } });
    const normalSigs = relayTypes.filter((t) => /normal_signature/.test(t));
    step('zero normal-signature messages on relay (settlement fully adaptor-based)', normalSigs.length === 0,
      'message types seen: ' + [...new Set(relayTypes)].join(', '));

    const invalidRod = rodChain.broadcasts.filter((b) => !b.valid);
    const invalidLtc = ltcChain.broadcasts.filter((b) => !b.valid);
    step('zero invalid broadcast attempts (ROD)', invalidRod.length === 0, invalidRod.map((b) => b.details.join()).join('; '));
    step('zero invalid broadcast attempts (LTC)', invalidLtc.length === 0, invalidLtc.map((b) => b.details.join()).join('; '));
  }

  /* ================= refund path ================= */
  async function runRefundPath() {
    await waitFor(() => rodChain.broadcasts.length > 0 || null, 60000, 'ROD funding broadcast');
    const rodFundingB = rodChain.broadcasts[0];
    step('ROD funding tx broadcast & independently validated', rodFundingB.valid, rodFundingB.details.join(' | '));

    // Bob requires 3 confirmations; height is frozen at 1 conf → he must NOT fund LTC
    await new Promise((r) => setTimeout(r, 8000)); // several automation ticks
    step('confirmation gate held: Bob did NOT fund LTC at 1/3 confirmations', ltcChain.broadcasts.length === 0,
      `ltc broadcasts: ${ltcChain.broadcasts.length}`);

    // refund is non-final before lock height
    const probe = rodChain.validateAndAccept(aliceRefund.signedHex);
    step('pre-signed ROD refund rejected as non-final before lock height',
      !probe.ok && /non-final/.test(probe.error || ''), probe.error || 'UNEXPECTEDLY ACCEPTED');

    // Bob disappears
    await bob.context().close();
    step('bob disappeared (context closed) after ROD funding', true);

    // chain advances past the refund height
    rodChain.height = START_HEIGHT + REFUND_ROD_BLOCKS + 5;

    await waitFor(() => rodChain.broadcasts.length > 1 || null, 90000, 'ROD refund broadcast by automation');
    const refundB = rodChain.broadcasts[1];
    step('pre-signed ROD refund broadcast & independently validated (locktime + 2-of-2 sigs)', refundB.valid, refundB.details.join(' | '));

    const aliceState = await waitFor(() => alice.evaluate((id) => {
      const s = rodOtc.engine.restoreLive(id);
      return (s && (s.state === 'REFUNDED' || s.state === 'ROD_REFUNDED')) ? s.state : null;
    }, swapId), 60000, 'alice refund state');
    step('alice session reached refund state', aliceState === 'REFUNDED' || aliceState === 'ROD_REFUNDED', aliceState);

    const refundDest = await alice.evaluate((id) => rodOtc.engine.restoreLive(id).terms.sellerRodRefundAddress, swapId);
    const refunded = rodChain.balance(refundDest);
    step('funds returned to Alice refund address (amount minus refund fee)',
      refunded === Math.round(100 * 1e8) - ROD_REFUND_FEE, `${refunded} sats at ${refundDest}`);

    const rodMultisig = await alice.evaluate((id) => rodOtc.engine.restoreLive(id).terms.rodFunding.multisigAddress, swapId);
    step('ROD multisig fully swept by refund', rodChain.balance(rodMultisig) === 0);

    const invalidRod = rodChain.broadcasts.filter((b) => !b.valid);
    step('zero invalid broadcast attempts (ROD)', invalidRod.length === 0, invalidRod.map((b) => b.details.join()).join('; '));
    step('zero LTC broadcasts at all (Bob never funded)', ltcChain.broadcasts.length === 0);
  }
}

main().catch((e) => {
  console.error('HARNESS ERROR:', e);
  process.exit(2);
});
