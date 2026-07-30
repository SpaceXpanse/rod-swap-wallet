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
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { MockChain, rodApiServer, esploraServer, blockcypherServer, nostrRelay, staticServer } = require('./mock-infra');

const APP_DIR = process.env.APP_DIR || path.resolve(__dirname, '..', '..');
const SCENARIO = process.env.SCENARIO || 'happy';
/* Which chain the counter leg runs on. Everything below is derived from this,
   so the identical proof runs against Litecoin-over-Esplora and
   Dogecoin-over-BlockCypher — different version bytes, different fee and dust
   policy, and a different API shape. */
const ALT = (process.env.ALT_CHAIN || 'LTC').toUpperCase();
const SUPPORTED_ALT_CHAINS = ['LTC', 'DOGE'];
if (!SUPPORTED_ALT_CHAINS.includes(ALT)) {
  throw new Error(
    `ALT_CHAIN=${ALT} is wallet-only or unsupported by this release's OTC registry; ` +
    `supported swap counters are ${SUPPORTED_ALT_CHAINS.join(', ')}`
  );
}

const ALT_PROFILES = {
  LTC: {
    /* 0.05 LTC is deliberately under 0.21 LTC (21,000,000 sats): that range is
       what the historical satoshi/coin unit bug mis-read as coin-denominated. */
    amount: '0.05000000',
    claimFee: 1000,
    refundBlocks: 24,
    confirmations: 1,
    apiType: 'esplora',
    apiPath: '/api',
    startServer: (chain, port) => esploraServer(chain, port)
  },
  DOGE: {
    /* 500 DOGE. Dogecoin's dust limits are ABSOLUTE (0.001 DOGE hard,
       0.01 DOGE soft), so amounts are chosen to sit clear of both while the
       0.01 DOGE settlement fee still clears the 1000 koinu/B mining floor for
       a ~305-byte 2-of-2 P2SH spend. */
    amount: '500.00000000',
    claimFee: 1000000,
    refundBlocks: 60,
    confirmations: 6,
    apiType: 'blockcypher',
    apiPath: '',
    startServer: (chain, port) => blockcypherServer(chain, port)
  }
};
const ALT_PROFILE = ALT_PROFILES[ALT];
if (!ALT_PROFILE) throw new Error('Unsupported ALT_CHAIN: ' + ALT);

const PORTS = { app: 9300, rod: 9301, alt: 9302, relay: 9303 };
const ROD_AMOUNT = '100.00000000';
const ALT_AMOUNT = ALT_PROFILE.amount;
const START_HEIGHT = 500000;
const RELEASE_HEIGHT = 500002;
const REFUND_ROD_BLOCKS = 480;  // 4h at ROD's 30-second target spacing
const ALT_REFUND_BLOCKS = ALT_PROFILE.refundBlocks;
const ROD_CLAIM_FEE = 51900;
const ALT_CLAIM_FEE = ALT_PROFILE.claimFee;
const ROD_REFUND_FEE = 51900;
const ALT_AMOUNT_SATS = Math.round(parseFloat(ALT_AMOUNT) * 1e8);

const results = { steps: [], ok: true };
const runtime = {
  browser: null,
  alice: null,
  bob: null,
  rodChain: null,
  altChain: null,
  relay: null,
  servers: [],
  swapId: '',
  browserIssues: []
};
function step(name, ok, detail) {
  results.steps.push({ name, ok, detail: detail || '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) results.ok = false;
}

function expectedTransientApiResponse(urlValue, status) {
  if (status !== 404) return false;
  const url = new URL(urlValue);
  if (url.hostname !== '127.0.0.1' || Number(url.port) !== PORTS.alt) return false;
  return /^\/api\/tx\/[0-9a-f]{64}(?:\/hex)?$/i.test(url.pathname) ||
    /^\/txs\/[0-9a-f]{64}$/i.test(url.pathname);
}

function resolveChromiumLaunchOptions() {
  const configuredExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.PW_CHROMIUM_EXECUTABLE_PATH;
  let args;
  if (process.env.PLAYWRIGHT_CHROMIUM_ARGS_JSON) {
    args = JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS_JSON);
    if (!Array.isArray(args)) throw new Error('PLAYWRIGHT_CHROMIUM_ARGS_JSON must be a JSON array');
  }
  if (configuredExecutablePath) {
    return { executablePath: configuredExecutablePath, args };
  }

  const pinnedExecutablePath = '/opt/pw-browsers/chromium';
  if (fs.existsSync(pinnedExecutablePath)) {
    return { executablePath: pinnedExecutablePath, args };
  }

  return args ? { args } : {};
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

async function sessionDiagnostics(page, swapId) {
  return page.evaluate((id) => {
    const session = rodOtc.engine.restoreLive(id);
    return {
      flash: $('#otcFlash').text(),
      eventLog: $('#otcLog').text(),
      session: session ? {
        state: session.state,
        localAccepted: !!session.localAccepted,
        remoteAccepted: !!session.remoteAccepted,
        bilateralReady: !!session.bilateralReady,
        localPrepared: !!session.localPrepared,
        remotePrepared: !!session.remotePrepared,
        hasAdaptorPoint: !!session.adaptorPoint,
        hasRodRefund: !!(session.rodRefund && session.rodRefund.signedHex),
        hasAltRefund: !!(session.altRefund && session.altRefund.signedHex),
        hasLocalRodAdaptorSignature: !!session.localRodAdaptorSignature,
        hasRemoteRodAdaptorSignature: !!session.remoteRodAdaptorSignature,
        hasLocalAltAdaptorSignature: !!session.localAltAdaptorSignature,
        hasRemoteAltAdaptorSignature: !!session.remoteAltAdaptorSignature,
        refundSafetyFault: session._refundSafetyFault || '',
        automationErrors: session._automationErrors || {},
        log: session._log || []
      } : null
    };
  }, swapId);
}

async function main() {
  const rodChain = new MockChain('ROD');
  const altChain = new MockChain(ALT);
  runtime.rodChain = rodChain;
  runtime.altChain = altChain;
  rodChain.height = START_HEIGHT;
  altChain.height = START_HEIGHT;
  runtime.servers.push(await rodApiServer(rodChain, PORTS.rod));
  runtime.servers.push(await ALT_PROFILE.startServer(altChain, PORTS.alt));
  const relay = nostrRelay(PORTS.relay);
  runtime.relay = relay;
  runtime.servers.push(await staticServer(APP_DIR, PORTS.app));
  console.log(`mock servers up · scenario=${SCENARIO} · alt=${ALT} via ${ALT_PROFILE.apiType} · app=${APP_DIR}`);

  const rodConfirmationsCfg = SCENARIO === 'refund' ? 3 : 1;

  const browser = await chromium.launch(resolveChromiumLaunchOptions());
  runtime.browser = browser;
  const mkContext = async (label) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.addInitScript(({ rodPort, altPort, relayPort, rodConfs, altCode, altType, altPath, altRefundBlocks, altConfirmations }) => {
      const altUrl = 'http://127.0.0.1:' + altPort + altPath;
      const altChains = {};
      altChains[altCode] = {
        apiUrl: altUrl,
        apiType: altType,
        refundBlocks: altRefundBlocks,
        confirmations: altConfirmations
      };
      localStorage.setItem('rodOtcEngineConfig', JSON.stringify({
        rodApiUrl: 'http://127.0.0.1:' + rodPort,
        altApiUrl: altUrl,
        altChains: altChains,
        relays: ['ws://127.0.0.1:' + relayPort],
        releaseBlocks: 2,
        refundRodBlocks: 480,
        altRefundBlocks: altRefundBlocks,
        rodConfirmations: rodConfs,
        altConfirmations: altConfirmations,
        tickMs: 1500
      }));
      localStorage.setItem('rodOtcTestAltChain', altCode);
    }, {
      rodPort: PORTS.rod, altPort: PORTS.alt, relayPort: PORTS.relay, rodConfs: rodConfirmationsCfg,
      altCode: ALT, altType: ALT_PROFILE.apiType, altPath: ALT_PROFILE.apiPath,
      altRefundBlocks: ALT_REFUND_BLOCKS, altConfirmations: ALT_PROFILE.confirmations
    });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      /* Chromium emits this generic line for HTTP errors. The response event
         below owns classification because it includes the URL and status. */
      if (/^Failed to load resource:/.test(text)) return;
      runtime.browserIssues.push({ page: label, type: 'console.error', detail: text });
    });
    page.on('response', (response) => {
      if (response.status() < 400) return;
      if (expectedTransientApiResponse(response.url(), response.status())) {
        if (process.env.TRACE_404) console.log(`[${label} expected HTTP ${response.status()}] ${response.url()}`);
        return;
      }
      runtime.browserIssues.push({
        page: label, type: 'http', status: response.status(), detail: response.url()
      });
    });
    page.on('requestfailed', (request) => {
      runtime.browserIssues.push({
        page: label, type: 'requestfailed', detail: request.url(),
        error: request.failure() ? request.failure().errorText : ''
      });
    });
    page.on('pageerror', (error) => {
      runtime.browserIssues.push({ page: label, type: 'pageerror', detail: error.message });
    });
    await page.goto(`http://127.0.0.1:${PORTS.app}/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.rodOtc && window.rodOtc.engine && window.jQuery);
    return page;
  };

  const alice = await mkContext('alice');
  const bob = await mkContext('bob');
  runtime.alice = alice;
  runtime.bob = bob;

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
    coinjs.setNetwork(localStorage.getItem('rodOtcTestAltChain') || 'LTC');
    const altAddress = coinjs.wif2address(keys.wif).address;
    coinjs.setNetwork(prevNet || 'ROD');
    return { address: keys.address, altAddress, pubkey: keys.pubkey, wif: keys.wif };
  });
  const setWallet = (page, wallet) => page.evaluate((w) => {
    $('#walletKeys .privkey').val(w.wif);
    $('#walletKeys .pubkey').val(w.pubkey);
    $('#walletAddress').text(w.address);
    return true;
  }, wallet);
  const aliceWallet = await mkWallet(alice);
  const bobWallet = await mkWallet(bob);
  console.log('alice ROD addr', aliceWallet.address, '| bob ROD addr', bobWallet.address, `| bob ${ALT} addr`, bobWallet.altAddress);

  rodChain.credit(aliceWallet.address, 2000 * 1e8);
  /* Two UTXOs, sized relative to the swap amount so the same multi-input
     selection path is exercised on every alt chain. */
  altChain.credit(bobWallet.altAddress, ALT_AMOUNT_SATS * 4);
  altChain.credit(bobWallet.altAddress, Math.round(ALT_AMOUNT_SATS * 0.6));

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
  await alice.evaluate(({ rod, alt, altCode, peerXpub, peerRodIdentity, peerRodPayout, release }) => {
    /* Select the counter chain FIRST: fees, dust limits, refund block counts
       and the payout address all derive from it. */
    $('#nsAltChain').val(altCode).trigger('change');
    $('#nsRole').val('seller');
    $('#nsRod').val(rod);
    $('#nsAlt').val(alt);
    $('#nsRelease').val(String(release));
    $('#nsPeer').val(peerRodIdentity);
    $('#nsPeerXpub').val(peerXpub);
    $('#nsPeerPayoutAddr').val(peerRodPayout);
    $('#nsCreate').click();
  }, {
    rod: ROD_AMOUNT, alt: ALT_AMOUNT, altCode: ALT, peerXpub: bobXpub,
    peerRodIdentity: bobWallet.address, peerRodPayout: bobWallet.address,
    release: RELEASE_HEIGHT
  });

  const swapId = await waitFor(() => alice.evaluate(() => $('#nsSwapId').val() || null), 20000, 'alice swap created');
  runtime.swapId = swapId;
  step('alice created swap session', !!swapId, 'swapId ' + swapId.slice(0, 16) + '…');

  // terms carry the refund protocol fields
  const termsCheck = await alice.evaluate((id) => {
    const s = rodOtc.engine.restoreLive(id);
    return {
      refundRodHeight: s.terms.refundRodHeight,
      altRefundLockHeight: s.terms.altRefundLockHeight,
      rodConfirmations: s.terms.rodConfirmations,
      altConfirmations: s.terms.altConfirmations,
      sellerRodRefundAddress: s.terms.sellerRodRefundAddress,
      buyerAltRefundAddress: s.terms.buyerAltRefundAddress,
      nonce: s.terms.termsNonce
    };
  }, swapId);
  step('terms include refund heights + confirmations + 5-field swapId nonce',
    termsCheck.refundRodHeight === START_HEIGHT + REFUND_ROD_BLOCKS &&
    termsCheck.altRefundLockHeight === START_HEIGHT + ALT_REFUND_BLOCKS &&
    termsCheck.rodConfirmations === rodConfirmationsCfg &&
    termsCheck.altConfirmations === ALT_PROFILE.confirmations &&
    !!termsCheck.sellerRodRefundAddress && !!termsCheck.buyerAltRefundAddress && !!termsCheck.nonce,
    JSON.stringify(termsCheck));

  try {
    await waitFor(() => bob.evaluate((id) => {
      const all = rodOtc.engine.loadLive();
      return all[id] ? true : null;
    }, swapId), 30000, 'bob auto-created session from swap_terms');
  } catch (error) {
    const diagnostics = await bob.evaluate((id) => ({
      flash: $('#otcFlash').text(),
      log: $('#otcLog').text(),
      seenEventIds: JSON.parse(localStorage.getItem('rodOtcSeenEventIds') || '[]'),
      liveSwapIds: Object.keys(rodOtc.engine.loadLive()),
      tracked: !!(rodOtc.engine.trackedSwapIds && rodOtc.engine.trackedSwapIds[id])
    }), swapId);
    error.message += '\nBob diagnostics: ' + JSON.stringify(diagnostics);
    throw error;
  }
  step('bob auto-created session from incoming terms', true);

  const accept = async (page) => {
    await page.evaluate((id) => {
      const card = $('.otc-swap-card[data-id="' + id + '"]');
      if (card.length) card.trigger('click');
      $('.otcExecBtn[data-action="accept-offer"]').trigger('click');
    }, swapId);
    return waitFor(() => page.evaluate((id) => {
      const session = rodOtc.engine.restoreLive(id);
      return session && session.localAccepted === true ? true : null;
    }, swapId), 15000, 'local acceptance after fresh refund-order check');
  };
  step('bob accepted', await accept(bob));
  step('alice accepted', await accept(alice));

  // ---- pre-funding pipeline → PREPARED on both, with NOTHING broadcast ----
  try {
    await waitFor(() => alice.evaluate((id) => {
      const s = rodOtc.engine.restoreLive(id);
      return (s && s.rodRefund && s.rodRefund.signedHex && s.localRodAdaptorSignature && s.remoteAltAdaptorSignature && s.localPrepared) ? true : null;
    }, swapId), 90000, 'alice PREPARED (refund signed + adaptor sigs verified)');
    await waitFor(() => bob.evaluate((id) => {
      const s = rodOtc.engine.restoreLive(id);
      return (s && s.altRefund && s.altRefund.signedHex && s.localAltAdaptorSignature && s.remoteRodAdaptorSignature && s.localPrepared) ? true : null;
    }, swapId), 90000, 'bob PREPARED (refund signed + adaptor sigs verified)');
  } catch (error) {
    error.message += '\nAlice diagnostics: ' + JSON.stringify(await sessionDiagnostics(alice, swapId));
    error.message += '\nBob diagnostics: ' + JSON.stringify(await sessionDiagnostics(bob, swapId));
    throw error;
  }
  step('both sides PREPARED: planned fundings, pre-signed refunds, verified adaptor signatures', true);

  const aliceRefund = await alice.evaluate((id) => {
    const s = rodOtc.engine.restoreLive(id);
    return { signedHex: s.rodRefund.signedHex, lockHeight: s.rodRefund.lockHeight, plannedTxid: s.plannedRodFunding.txid };
  }, swapId);
  const bobRefund = await bob.evaluate((id) => {
    const s = rodOtc.engine.restoreLive(id);
    return { signedHex: s.altRefund.signedHex, lockHeight: s.altRefund.lockHeight, plannedTxid: s.plannedAltFunding.txid };
  }, swapId);
  step('refund locktimes match terms',
    aliceRefund.lockHeight === START_HEIGHT + REFUND_ROD_BLOCKS && bobRefund.lockHeight === START_HEIGHT + ALT_REFUND_BLOCKS,
    `ROD refund locks at ${aliceRefund.lockHeight}, ${ALT} refund locks at ${bobRefund.lockHeight}`);

  if (SCENARIO === 'happy') {
    await runHappyPath();
  } else if (SCENARIO === 'altrefund') {
    await runAltRefundPath();
  } else {
    await runRefundPath();
  }

  step('no unexpected browser console, page, request, or HTTP errors',
    runtime.browserIssues.length === 0, JSON.stringify(runtime.browserIssues));

  fs.writeFileSync(path.join(__dirname, `e2e-report-${ALT.toLowerCase()}-${SCENARIO}.json`), JSON.stringify({
    scenario: SCENARIO,
    swapId,
    steps: results.steps,
    rodBroadcasts: rodChain.broadcasts,
    altBroadcasts: altChain.broadcasts,
    browserIssues: runtime.browserIssues,
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

    // timeline ordering: PREPARED strictly before SELLER_ROD_FUNDED
    const timeline = await alice.evaluate((id) => (rodOtc.engine.restoreLive(id).timeline || []).map((t) => t.state), swapId);
    const preparedIdx = timeline.indexOf('PREPARED');
    const fundedIdx = timeline.indexOf('SELLER_ROD_FUNDED');
    step('timeline: PREPARED precedes ROD funding broadcast', preparedIdx !== -1 && fundedIdx !== -1 && preparedIdx < fundedIdx,
      timeline.join(' → '));

    await waitFor(() => altChain.broadcasts.length > 0 || null, 120000, `${ALT} funding broadcast`);
    const altFundingB = altChain.broadcasts[0];
    step(`${ALT} funding tx broadcast & independently validated (${ALT_AMOUNT} ${ALT})`, altFundingB.valid, altFundingB.details.join(' | '));
    step(`${ALT} funding txid equals PLANNED txid`, altFundingB.txid === bobRefund.plannedTxid);

    if (ALT_PROFILE.confirmations > 1) {
      await new Promise((resolve) => setTimeout(resolve, 3500));
      step(`${ALT} confirmation gate prevents claim at 1/${ALT_PROFILE.confirmations}`,
        altChain.broadcasts.length === 1, `alt broadcasts: ${altChain.broadcasts.length}`);
      altChain.height += ALT_PROFILE.confirmations - 1;
    }

    if (process.env.RELOAD_TEST === '1') {
      await alice.reload({ waitUntil: 'load' });
      await alice.waitForFunction(() => window.rodOtc && window.rodOtc.engine && window.jQuery);
      await setWallet(alice, aliceWallet);
      await alice.evaluate(() => { $('a[href="#otc"]').tab('show'); });
      await waitFor(() => alice.evaluate(() => (rodOtc.engine.pool && rodOtc.engine.pool.count() >= 1) || null), 15000, 'alice relay reconnect after reload');
      const persisted = await alice.evaluate((id) => {
        const s = rodOtc.engine.restoreLive(id);
        return !!(s && s.remoteAltAdaptorSignature && s.rodRefund && s.rodRefund.signedHex && s.adaptorSecret);
      }, swapId);
      step('after reload: adaptor sig, refund and secret persisted', persisted);
    }

    // release the claim height gate
    rodChain.height = RELEASE_HEIGHT + 1;

    await waitFor(() => altChain.broadcasts.length > 1 || null, 120000, `${ALT} claim broadcast`);
    const altClaimB = altChain.broadcasts[1];
    step(`${ALT} claim tx (2-of-2 P2SH, completed adaptor sig) broadcast & independently validated`, altClaimB.valid, altClaimB.details.join(' | '));

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
        sellerAltPayout: s.terms.sellerAltPayoutAddress,
        buyerRodPayout: s.terms.buyerRodPayoutAddress,
        altMultisig: s.terms.altFunding.multisigAddress,
        rodMultisig: s.terms.rodFunding.multisigAddress
      };
    }, swapId);
    const aliceGotAlt = altChain.balance(dests.sellerAltPayout);
    const bobGotRod = rodChain.balance(dests.buyerRodPayout);
    step(`alice received ${ALT} at her payout address`, aliceGotAlt === ALT_AMOUNT_SATS - ALT_CLAIM_FEE,
      `${aliceGotAlt} sats at ${dests.sellerAltPayout}`);
    step('bob received ROD at his payout address', bobGotRod === Math.round(100 * 1e8) - ROD_CLAIM_FEE,
      `${bobGotRod} sats at ${dests.buyerRodPayout}`);
    step(`${ALT} multisig fully swept`, altChain.balance(dests.altMultisig) === 0);
    step('ROD multisig fully swept', rodChain.balance(dests.rodMultisig) === 0);

    // atomicity proof: NO normal-signature messages were ever needed
    const relayTypes = relay.events.map((e) => { try { return JSON.parse(e.content).type; } catch (err) { return ''; } });
    const normalSigs = relayTypes.filter((t) => /normal_signature/.test(t));
    step('zero normal-signature messages on relay (settlement fully adaptor-based)', normalSigs.length === 0,
      'message types seen: ' + [...new Set(relayTypes)].join(', '));

    const invalidRod = rodChain.broadcasts.filter((b) => !b.valid);
    const invalidAlt = altChain.broadcasts.filter((b) => !b.valid);
    step('zero invalid broadcast attempts (ROD)', invalidRod.length === 0, invalidRod.map((b) => b.details.join()).join('; '));
    step(`zero invalid broadcast attempts (${ALT})`, invalidAlt.length === 0, invalidAlt.map((b) => b.details.join()).join('; '));
  }

  /* ================= refund path ================= */
  async function runRefundPath() {
    await waitFor(() => rodChain.broadcasts.length > 0 || null, 60000, 'ROD funding broadcast');
    const rodFundingB = rodChain.broadcasts[0];
    step('ROD funding tx broadcast & independently validated', rodFundingB.valid, rodFundingB.details.join(' | '));

    // Bob requires 3 confirmations; height is frozen at 1 conf → he must NOT fund LTC
    await new Promise((r) => setTimeout(r, 8000)); // several automation ticks
    step(`confirmation gate held: Bob did NOT fund ${ALT} at 1/3 confirmations`, altChain.broadcasts.length === 0,
      `alt broadcasts: ${altChain.broadcasts.length}`);

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
    step(`zero ${ALT} broadcasts at all (Bob never funded)`, altChain.broadcasts.length === 0);
  }

  /* ================= alt-leg refund path =================
     The mirror image of runRefundPath, and the case that matters most for a
     newly-added chain: BOTH legs are funded, then the secret holder vanishes
     WITHOUT claiming. Bob must be able to recover his alt coin using only the
     refund he pre-signed before any coin moved. This exercises a timelocked
     2-of-2 P2SH spend under the alt chain's own consensus and relay policy —
     on Dogecoin that means legacy sighash, low-S DER, nLockTime finality with
     sequence 0xfffffffe, the absolute dust limits and the koinu/byte fee
     floor, none of which the Litecoin path proves. */
  async function runAltRefundPath() {
    await waitFor(() => rodChain.broadcasts.length > 0 || null, 60000, 'ROD funding broadcast');
    step('ROD funding tx broadcast & independently validated', rodChain.broadcasts[0].valid,
      rodChain.broadcasts[0].details.join(' | '));

    await waitFor(() => altChain.broadcasts.length > 0 || null, 120000, `${ALT} funding broadcast`);
    const altFundingB = altChain.broadcasts[0];
    step(`${ALT} funding tx broadcast & independently validated`, altFundingB.valid, altFundingB.details.join(' | '));
    step(`${ALT} funding txid equals PLANNED txid`, altFundingB.txid === bobRefund.plannedTxid);

    /* The pre-signed alt refund must be worthless until its lock height. */
    const probe = altChain.validateAndAccept(bobRefund.signedHex);
    step(`pre-signed ${ALT} refund rejected as non-final before lock height`,
      !probe.ok && /non-final/.test(probe.error || ''), probe.error || 'UNEXPECTEDLY ACCEPTED');

    /* Alice vanishes holding the secret, without ever claiming. */
    await alice.context().close();
    step('alice disappeared (context closed) without claiming', true);

    altChain.height = START_HEIGHT + ALT_REFUND_BLOCKS + 5;

    await waitFor(() => altChain.broadcasts.length > 1 || null, 120000, `${ALT} refund broadcast by automation`);
    const altRefundB = altChain.broadcasts[1];
    step(`pre-signed ${ALT} refund broadcast & independently validated (locktime + 2-of-2 sigs + ${ALT} policy)`,
      altRefundB.valid, altRefundB.details.join(' | '));

    const bobState = await waitFor(() => bob.evaluate((id) => {
      const s = rodOtc.engine.restoreLive(id);
      return (s && /REFUND/.test(s.state)) ? s.state : null;
    }, swapId), 60000, 'bob refund state');
    step('bob session reached a refund state', /REFUND/.test(bobState), bobState);

    const bobDests = await bob.evaluate((id) => {
      const t = rodOtc.engine.restoreLive(id).terms;
      return { refundAddr: t.buyerAltRefundAddress, multisig: t.altFunding.multisigAddress, refundFee: t.altRefundFee };
    }, swapId);
    const refunded = altChain.balance(bobDests.refundAddr);
    const expected = ALT_AMOUNT_SATS - Math.round(parseFloat(bobDests.refundFee) * 1e8);
    step(`${ALT} returned to Bob's refund address (amount minus refund fee)`, refunded === expected,
      `${refunded} vs expected ${expected} at ${bobDests.refundAddr}`);
    step(`${ALT} multisig fully swept by refund`, altChain.balance(bobDests.multisig) === 0);

    const invalidAlt = altChain.broadcasts.filter((b) => !b.valid);
    step(`zero invalid broadcast attempts (${ALT})`, invalidAlt.length === 0,
      invalidAlt.map((b) => b.details.join()).join('; '));
    step('alice never claimed: no secret was ever revealed on the alt chain',
      altChain.broadcasts.filter((b) => b.valid).length === 2,
      `${altChain.broadcasts.length} alt broadcasts (funding + refund only)`);
  }
}

main().catch(async (e) => {
  const report = {
    scenario: SCENARIO,
    swapId: runtime.swapId,
    ok: false,
    error: e && (e.stack || e.message) || String(e),
    steps: results.steps,
    browserIssues: runtime.browserIssues,
    rodBroadcasts: runtime.rodChain ? runtime.rodChain.broadcasts : [],
    altBroadcasts: runtime.altChain ? runtime.altChain.broadcasts : [],
    relayEventTypes: runtime.relay && runtime.relay.events
      ? runtime.relay.events.map((event) => {
          try { return JSON.parse(event.content).type; } catch (error) { return 'unknown'; }
        })
      : []
  };
  for (const [label, page] of [['alice', runtime.alice], ['bob', runtime.bob]]) {
    try {
      if (page && !page.isClosed()) report[label] = await sessionDiagnostics(page, runtime.swapId);
    } catch (diagnosticError) {
      report[label] = { diagnosticError: diagnosticError.message };
    }
  }
  fs.writeFileSync(
    path.join(__dirname, `e2e-report-${ALT.toLowerCase()}-${SCENARIO}.json`),
    JSON.stringify(report, null, 2)
  );
  try { if (runtime.browser) await runtime.browser.close(); } catch (closeError) {}
  for (const server of runtime.servers) {
    try { server.close(); } catch (closeError) {}
  }
  try { if (runtime.relay && runtime.relay.close) runtime.relay.close(); } catch (closeError) {}
  console.error('HARNESS ERROR:', e);
  process.exit(2);
});
