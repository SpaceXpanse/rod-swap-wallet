/*
 * End-to-end ROD↔LTC OTC swap proof.
 *
 * Runs the REAL wallet app (unmodified index.html + js/) in two headless
 * Chromium contexts — Alice (sells ROD) and Bob (buys ROD with LTC) — wired
 * to mock chain APIs that INDEPENDENTLY validate every broadcast transaction
 * (bitcoinjs-lib sighash + noble secp256k1), and a real local Nostr relay.
 *
 * Success criteria:
 *   1. In-page OTC validation suite passes in both browsers.
 *   2. Alice's ROD funding tx accepted by mock ROD node (full sig check).
 *   3. Bob's LTC funding tx accepted by mock LTC esplora (full sig check),
 *      with a small (0.05 LTC < 0.21 LTC) amount to prove the sat/coin fix.
 *   4. Alice's LTC claim tx (2-of-2 P2SH CHECKMULTISIG) accepted + verified.
 *   5. Bob's ROD claim tx (2-of-2 P2SH CHECKMULTISIG) accepted + verified.
 *   6. Both sessions reach COMPLETE.
 *   7. Zero invalid broadcast attempts on either chain.
 */
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const { MockChain, rodApiServer, esploraServer, nostrRelay, staticServer } = require('./mock-infra');

const APP_DIR = path.resolve('/root/work/rodwebswap');
const PORTS = { app: 9300, rod: 9301, ltc: 9302, relay: 9303 };
const ROD_AMOUNT = '100.00000000';
const LTC_AMOUNT = '0.05000000'; // deliberately < 0.21 LTC to prove the unit fix

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
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function main() {
  const rodChain = new MockChain('ROD');
  const ltcChain = new MockChain('LTC');
  await rodApiServer(rodChain, PORTS.rod);
  await esploraServer(ltcChain, PORTS.ltc);
  const relay = nostrRelay(PORTS.relay);
  await staticServer(APP_DIR, PORTS.app);
  console.log('mock servers up');

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const mkContext = async (label) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.addInitScript(({ rodPort, ltcPort, relayPort }) => {
      localStorage.setItem('rodOtcEngineConfig', JSON.stringify({
        rodApiUrl: 'http://127.0.0.1:' + rodPort,
        ltcApiUrl: 'http://127.0.0.1:' + ltcPort + '/api',
        relays: ['ws://127.0.0.1:' + relayPort],
        releaseBlocks: 20
      }));
    }, { rodPort: PORTS.rod, ltcPort: PORTS.ltc, relayPort: PORTS.relay });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') console.log(`[${label} console.error] ${m.text()}`);
    });
    page.on('pageerror', (e) => console.log(`[${label} pageerror] ${e.message}`));
    await page.goto(`http://127.0.0.1:${PORTS.app}/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.rodOtc && window.rodOtc.engine && window.jQuery);
    if (process.env.REGRESSION === '1') {
      // The ORIGINAL code never propagates the configured API URLs into
      // coinjs.networks (that is one of the fixed bugs). Patch them directly
      // here so the regression run can reach the deeper LTC unit bug.
      await page.evaluate(({ rodPort, ltcPort }) => {
        coinjs.networks.ROD.apiBase = 'http://127.0.0.1:' + rodPort;
        coinjs.rodApi = coinjs.networks.ROD.apiBase;
        coinjs.networks.LTC.apiBase = 'http://127.0.0.1:' + ltcPort + '/api';
      }, { rodPort: PORTS.rod, ltcPort: PORTS.ltc });
    }
    return page;
  };

  const alice = await mkContext('alice');
  const bob = await mkContext('bob');

  // ---- create wallets in-page (compressed keys, ROD network active) ----
  const mkWallet = (page) => page.evaluate(() => {
    coinjs.setNetwork('ROD');
    const prevCompressed = coinjs.compressed;
    coinjs.compressed = true;
    const keys = coinjs.newKeys();
    coinjs.compressed = prevCompressed;
    $('#walletKeys .privkey').val(keys.wif);
    $('#walletKeys .pubkey').val(keys.pubkey);
    $('#walletAddress').text(keys.address);
    // LTC address of the same key
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
  console.log('alice ROD addr', aliceWallet.address, '| bob LTC addr', bobWallet.ltcAddress);

  // fund the mock chains: Alice needs ROD, Bob needs LTC
  rodChain.credit(aliceWallet.address, 2000 * 1e8);      // 2000 ROD
  ltcChain.credit(bobWallet.ltcAddress, Math.round(0.2 * 1e8)); // 0.2 LTC (several small utxos)
  ltcChain.credit(bobWallet.ltcAddress, Math.round(0.03 * 1e8)); // + 0.03 LTC small utxo

  // ---- in-page validation suite (both browsers) ----
  for (const [label, page] of [['alice', alice], ['bob', bob]]) {
    const suite = await page.evaluate(() => rodOtc.validation.runAll());
    step(`${label}: in-page OTC validation suite`, !!suite.passed,
      suite.results.map((r) => `${r.name}:${r.passed ? 'ok' : 'FAIL'}`).join(', '));
  }

  // ---- open OTC tab on both (triggers wallet detection + relay connect) ----
  for (const page of [alice, bob]) {
    await page.evaluate(() => { $('a[href="#otc"]').tab('show'); });
  }
  await waitFor(async () => {
    const a = await alice.evaluate(() => rodOtc.engine.pool && rodOtc.engine.pool.count());
    const b = await bob.evaluate(() => rodOtc.engine.pool && rodOtc.engine.pool.count());
    return a >= 1 && b >= 1;
  }, 15000, 'both pages connected to local Nostr relay');
  step('both pages connected to local Nostr relay', true);

  // wallet identity picked up
  await waitFor(() => alice.evaluate(() => $('#nsMyXpub').val() ? true : false), 15000, 'alice swap xpub');
  await waitFor(() => bob.evaluate(() => $('#nsMyXpub').val() ? true : false), 15000, 'bob swap xpub');
  const bobXpub = await bob.evaluate(() => $('#nsMyXpub').val());
  step('swap accounts derived (both)', !!bobXpub, 'bob xpub ' + bobXpub.slice(0, 12) + '…');

  // ---- Alice creates & starts the swap against Bob's swap xpub ----
  await alice.evaluate(({ rod, ltc, peerXpub }) => {
    $('#nsRole').val('alice');
    $('#nsRod').val(rod);
    $('#nsLtc').val(ltc);
    $('#nsRelease').val('500020');
    $('#nsPeer').val('bob-e2e-test');
    $('#nsPeerXpub').val(peerXpub);
    $('#nsCreate').click();
  }, { rod: ROD_AMOUNT, ltc: LTC_AMOUNT, peerXpub: bobXpub });

  const swapId = await waitFor(() => alice.evaluate(() => $('#nsSwapId').val() || null), 20000, 'alice swap created');
  step('alice created swap session', !!swapId, 'swapId ' + swapId.slice(0, 16) + '…');

  // ---- Bob auto-creates session from incoming swap_terms ----
  await waitFor(() => bob.evaluate((id) => {
    const all = rodOtc.engine.loadLive();
    return all[id] ? true : null;
  }, swapId), 30000, 'bob auto-created session from swap_terms');
  step('bob auto-created session from incoming terms', true);

  // both accept
  const accept = (page) => page.evaluate((id) => {
    const s = rodOtc.engine.restoreLive(id);
    // simulate the Accept button handler
    const card = $('.otc-swap-card[data-id="' + id + '"]');
    if (card.length) card.trigger('click');
    $('.otcExecBtn[data-action="accept-offer"]').trigger('click');
    return rodOtc.engine.restoreLive(id).localAccepted === true;
  }, swapId);
  step('bob accepted', await accept(bob));
  step('alice accepted', await accept(alice));

  // ---- automation: ROD funding (Alice) → verify (both) → LTC funding (Bob) → verify ----
  await waitFor(() => rodChain.broadcasts.length > 0 || null, 60000, 'ROD funding broadcast');
  const rodFundingB = rodChain.broadcasts[0];
  step('ROD funding tx broadcast & independently validated', rodFundingB.valid, rodFundingB.details.join(' | '));

  await waitFor(() => ltcChain.broadcasts.length > 0 || null, 120000, 'LTC funding broadcast');
  const ltcFundingB = ltcChain.broadcasts[0];
  step('LTC funding tx broadcast & independently validated (0.05 LTC < 0.21 LTC)', ltcFundingB.valid, ltcFundingB.details.join(' | '));

  // wait for signatures to be exchanged and Alice's LTC claim to become ready
  await waitFor(() => alice.evaluate((id) => {
    const s = rodOtc.engine.restoreLive(id);
    return !!(s && s.execution && s.execution.ltcFunding && s.execution.ltcFunding.vout != null &&
      s.localLtcClaimSignature && s.remoteLtcClaimSignature) || null;
  }, swapId), 120000, 'alice ready to claim LTC (both signatures present)');
  step('claim signatures exchanged over Nostr (LTC side)', true);

  // ---- reload-resilience scenario: reload Alice mid-swap. The relay will
  // replay ALL past events (including her own) into a fresh page whose
  // engine-level seen{} cache is empty — before the echo-guard fix this
  // overwrote remote* signature slots with her own signatures. ----
  if (process.env.RELOAD_TEST === '1') {
    await alice.reload({ waitUntil: 'load' });
    await alice.waitForFunction(() => window.rodOtc && window.rodOtc.engine && window.jQuery);
    await setWallet(alice, aliceWallet);
    await alice.evaluate(() => { $('a[href="#otc"]').tab('show'); });
    await waitFor(() => alice.evaluate(() => (rodOtc.engine.pool && rodOtc.engine.pool.count() >= 1) || null), 15000, 'alice relay reconnect after reload');
    // give the relay replay + resumeAfterReload time to run
    await new Promise((r) => setTimeout(r, 6000));
    const sigCheck = await alice.evaluate((id) => {
      const s = rodOtc.engine.restoreLive(id);
      return {
        hasLocal: !!s.localLtcClaimSignature,
        hasRemote: !!s.remoteLtcClaimSignature,
        distinct: !!(s.localLtcClaimSignature && s.remoteLtcClaimSignature && s.localLtcClaimSignature !== s.remoteLtcClaimSignature)
      };
    }, swapId);
    step('after reload: replayed own events did NOT clobber counterparty signature',
      sigCheck.hasLocal && sigCheck.hasRemote && sigCheck.distinct, JSON.stringify(sigCheck));
  }

  // ---- Alice claims LTC ----
  await alice.evaluate((id) => {
    $('.otc-swap-card[data-id="' + id + '"]').trigger('click');
    $('.otcExecBtn[data-action="claim-ltc"]').prop('disabled', false).trigger('click');
  }, swapId);
  await waitFor(() => ltcChain.broadcasts.length > 1 || null, 60000, 'LTC claim broadcast');
  const ltcClaimB = ltcChain.broadcasts[1];
  step('LTC claim tx (2-of-2 P2SH) broadcast & independently validated', ltcClaimB.valid, ltcClaimB.details.join(' | '));

  // ---- Bob claims ROD (needs ltcClaim evidence + Alice's ROD signature) ----
  await waitFor(() => bob.evaluate((id) => {
    const s = rodOtc.engine.restoreLive(id);
    return !!(s && s.execution && s.execution.ltcClaim && s.execution.ltcClaim.txid &&
      s.remoteRodClaimSignature && s.execution.rodFunding && s.execution.rodFunding.vout != null) || null;
  }, swapId), 120000, 'bob ready to claim ROD');
  await bob.evaluate((id) => {
    $('.otc-swap-card[data-id="' + id + '"]').trigger('click');
    $('.otcExecBtn[data-action="claim-rod"]').prop('disabled', false).trigger('click');
  }, swapId);
  await waitFor(() => rodChain.broadcasts.length > 1 || null, 60000, 'ROD claim broadcast');
  const rodClaimB = rodChain.broadcasts[1];
  step('ROD claim tx (2-of-2 P2SH) broadcast & independently validated', rodClaimB.valid, rodClaimB.details.join(' | '));

  // ---- final states ----
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

  // ---- money-flow assertions ----
  const aliceChild = await alice.evaluate((id) => {
    const s = rodOtc.engine.restoreLive(id);
    return {
      aliceLtcDest: rodOtc.chains.publicKeyToAddress('LTC', s.terms.aliceChildPubKey, 'legacy'),
      bobRodDest: rodOtc.chains.publicKeyToAddress('ROD', s.terms.bobChildPubKey, 'legacy'),
      ltcMultisig: s.terms.ltcFunding.multisigAddress,
      rodMultisig: s.terms.rodFunding.multisigAddress
    };
  }, swapId);
  const aliceGotLtc = ltcChain.balance(aliceChild.aliceLtcDest);
  const bobGotRod = rodChain.balance(aliceChild.bobRodDest);
  step('alice received LTC at her claim address', aliceGotLtc === Math.round(0.05 * 1e8) - 1000,
    `${aliceGotLtc} sats at ${aliceChild.aliceLtcDest}`);
  step('bob received ROD at his claim address', bobGotRod === Math.round(100 * 1e8) - 51900,
    `${bobGotRod} sats at ${aliceChild.bobRodDest}`);
  step('LTC multisig fully swept', ltcChain.balance(aliceChild.ltcMultisig) === 0);
  step('ROD multisig fully swept', rodChain.balance(aliceChild.rodMultisig) === 0);

  const invalidRod = rodChain.broadcasts.filter((b) => !b.valid);
  const invalidLtc = ltcChain.broadcasts.filter((b) => !b.valid);
  step('zero invalid broadcast attempts (ROD)', invalidRod.length === 0, invalidRod.map((b) => b.details.join()).join('; '));
  step('zero invalid broadcast attempts (LTC)', invalidLtc.length === 0, invalidLtc.map((b) => b.details.join()).join('; '));

  // dump artifacts
  const fs = require('fs');
  fs.writeFileSync('/root/work/harness/e2e-report.json', JSON.stringify({
    swapId,
    steps: results.steps,
    rodBroadcasts: rodChain.broadcasts,
    ltcBroadcasts: ltcChain.broadcasts,
    relayEvents: relay.events.map((e) => ({ kind: e.kind, tags: e.tags.filter((t) => t[0] === 'type'), id: e.id.slice(0, 12) }))
  }, null, 2));

  await browser.close();
  console.log('\n================= RESULT =================');
  console.log(results.ok ? 'ALL CHECKS PASSED ✓' : 'FAILURES PRESENT ✗');
  process.exit(results.ok ? 0 : 1);
}

main().catch((e) => {
  console.error('HARNESS ERROR:', e);
  process.exit(2);
});
