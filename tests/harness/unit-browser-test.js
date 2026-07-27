/*
 * Fast in-browser unit checks for the chain / policy / adapter layers.
 *
 * Loads the REAL app (unmodified index.html + js/) in one headless Chromium
 * page and asserts against the live globals. This is the quick feedback loop
 * that sits underneath the full e2e-swap-test.js proof — it runs in seconds
 * instead of minutes, so every refactor step can be gated on it.
 *
 *   node unit-browser-test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { staticServer } = require('./mock-infra');

const APP_DIR = process.env.APP_DIR || path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.UNIT_PORT || 9400);

const results = { steps: [], ok: true };
function step(name, ok, detail) {
  results.steps.push({ name, ok, detail: detail || '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) results.ok = false;
}

function resolveChromiumLaunchOptions() {
  const configuredExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.PW_CHROMIUM_EXECUTABLE_PATH;
  if (configuredExecutablePath) {
    return { executablePath: configuredExecutablePath };
  }

  const pinnedExecutablePath = '/opt/pw-browsers/chromium';
  if (fs.existsSync(pinnedExecutablePath)) {
    return { executablePath: pinnedExecutablePath };
  }

  return {};
}

async function main() {
  const app = await staticServer(APP_DIR, PORT);
  const browser = await chromium.launch(resolveChromiumLaunchOptions());
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.rodOtc && window.rodOtc.chains && window.rodOtc.validation && window.coinjs,
    null,
    { timeout: 30000 }
  );

  step('app loaded with no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));

  // ---- in-page validation suite (adaptor, chains, storage, nostr, fixtures)
  const suite = await page.evaluate(() => window.rodOtc.validation.runAll());
  const suiteDetail = suite.results.map((r) => `${r.name}:${r.passed ? 'ok' : 'FAIL'}`).join(', ');
  step('in-page OTC validation suite', !!suite.passed, suiteDetail);

  // ---- DOGE network profile is registered and correct
  const net = await page.evaluate(() => {
    const n = window.coinjs.networks.DOGE;
    return n && {
      pub: n.pub, priv: n.priv, multisig: n.multisig,
      hdPub: n.hdkey.pub, hdPrv: n.hdkey.prv,
      segwit: n.segwit, unit: n.unit, apiType: n.apiType
    };
  });
  step(
    'coinjs.networks.DOGE version bytes match Dogecoin Core chainparams',
    !!net && net.pub === 0x1e && net.priv === 0x9e && net.multisig === 0x16
      && net.hdPub === 0x02facafd && net.hdPrv === 0x02fac398 && net.segwit === false,
    net ? `pub=0x${net.pub.toString(16)} priv=0x${net.priv.toString(16)} multisig=0x${net.multisig.toString(16)} hd=0x${net.hdPub.toString(16)}/0x${net.hdPrv.toString(16)} segwit=${net.segwit}` : 'missing'
  );

  // ---- DOGE addresses match independently generated vectors
  const vectors = await page.evaluate(() => {
    const C = window.rodOtc.chains;
    const k1 = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
    const k2 = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
    const ms = C.publicKeysToMultisig('DOGE', [k1, k2], 2);
    return { p2pkh: C.publicKeyToAddress('DOGE', k1, 'legacy'), p2sh: ms.address, redeem: ms.redeemScript };
  });
  step(
    'DOGE P2PKH + 2-of-2 P2SH match bitcoinjs-lib vectors',
    vectors.p2pkh === 'DFpN6QqFfUm3gKNaxN6tNcab1FArL9cZLE'
      && vectors.p2sh === '9tAfWptDmGyYyFjKKr5VpApUKzq9hFpBJ1',
    `${vectors.p2pkh} / ${vectors.p2sh}`
  );

  // ---- WIF round-trip on DOGE (0x9e -> 'Q' compressed)
  const wif = await page.evaluate(() => {
    return window.rodOtc.chains.withChain('DOGE', function () {
      const prev = window.coinjs.compressed;
      window.coinjs.compressed = true;
      const w = window.coinjs.privkey2wif('0000000000000000000000000000000000000000000000000000000000000001');
      const back = window.coinjs.wif2privkey(w);
      const addr = window.coinjs.wif2address(w).address;
      window.coinjs.compressed = prev;
      return { wif: w, priv: back.privkey, addr: addr };
    });
  });
  step(
    'DOGE WIF encode/decode round-trips and derives the vector address',
    wif.wif === 'QNcdLVw8fHkixm6NNyN6nVwxKek4u7qrioRbQmjxac5TVoTtZuot'
      && wif.priv === '0000000000000000000000000000000000000000000000000000000000000001'
      && wif.addr === 'DFpN6QqFfUm3gKNaxN6tNcab1FArL9cZLE',
    `${wif.wif.slice(0, 12)}… -> ${wif.addr}`
  );

  // ---- BTC network profile is registered and correct
  const btcNet = await page.evaluate(() => {
    const n = window.coinjs.networks.BTC;
    return n && {
      pub: n.pub, priv: n.priv, multisig: n.multisig,
      hdPub: n.hdkey.pub, hdPrv: n.hdkey.prv,
      segwit: n.segwit, unit: n.unit, apiType: n.apiType,
      hrp: n.bech32.hrp
    };
  });
  step(
    'coinjs.networks.BTC version bytes match Bitcoin Core chainparams',
    !!btcNet && btcNet.pub === 0x00 && btcNet.priv === 0x80 && btcNet.multisig === 0x05
      && btcNet.hdPub === 0x0488B21E && btcNet.hdPrv === 0x0488ADE4 && btcNet.segwit === true
      && btcNet.hrp === 'bc',
    btcNet ? `pub=0x${btcNet.pub.toString(16)} priv=0x${btcNet.priv.toString(16)} multisig=0x${btcNet.multisig.toString(16)} hd=0x${btcNet.hdPub.toString(16)}/0x${btcNet.hdPrv.toString(16)} segwit=${btcNet.segwit} hrp=${btcNet.hrp}` : 'missing'
  );

  // ---- BCH network profile is registered and correct
  const bchNet = await page.evaluate(() => {
    const n = window.coinjs.networks.BCH;
    return n && {
      pub: n.pub, priv: n.priv, multisig: n.multisig,
      hdPub: n.hdkey.pub, hdPrv: n.hdkey.prv,
      segwit: n.segwit, unit: n.unit, apiType: n.apiType,
      hrp: n.bech32.hrp
    };
  });
  step(
    'coinjs.networks.BCH version bytes match Bitcoin Cash (same as BTC), segwit disabled',
    !!bchNet && bchNet.pub === 0x00 && bchNet.priv === 0x80 && bchNet.multisig === 0x05
      && bchNet.hdPub === 0x0488B21E && bchNet.hdPrv === 0x0488ADE4 && bchNet.segwit === false
      && bchNet.hrp === '',
    bchNet ? `pub=0x${bchNet.pub.toString(16)} priv=0x${bchNet.priv.toString(16)} multisig=0x${bchNet.multisig.toString(16)} hd=0x${bchNet.hdPub.toString(16)}/0x${bchNet.hdPrv.toString(16)} segwit=${bchNet.segwit} hrp='${bchNet.hrp}'` : 'missing'
  );

  // ---- BTC addresses match well-known vectors
  const btcVectors = await page.evaluate(() => {
    const C = window.rodOtc.chains;
    const k1 = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
    const k2 = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
    const ms = C.publicKeysToMultisig('BTC', [k1, k2], 2);
    const bech32Addr = C.publicKeyToAddress('BTC', k1, 'bech32');
    return { p2pkh: C.publicKeyToAddress('BTC', k1, 'legacy'), p2sh: ms.address, bech32: bech32Addr };
  });
  step(
    'BTC P2PKH + 2-of-2 P2SH + bech32 match well-known vectors',
    btcVectors.p2pkh === '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH'
      && btcVectors.p2sh === '33RQmypKhD6f4tMquiR5a3C6dRT7eBpaiG'
      && btcVectors.bech32.indexOf('bc1') === 0,
    `${btcVectors.p2pkh} / ${btcVectors.p2sh} / ${btcVectors.bech32}`
  );

  // ---- BCH legacy addresses are byte-identical to BTC (same version bytes)
  const bchVectors = await page.evaluate(() => {
    const C = window.rodOtc.chains;
    const k1 = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
    const k2 = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
    const ms = C.publicKeysToMultisig('BCH', [k1, k2], 2);
    return { p2pkh: C.publicKeyToAddress('BCH', k1, 'legacy'), p2sh: ms.address };
  });
  step(
    'BCH legacy addresses are byte-identical to BTC (same version bytes)',
    bchVectors.p2pkh === '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH'
      && bchVectors.p2sh === '33RQmypKhD6f4tMquiR5a3C6dRT7eBpaiG',
    `${bchVectors.p2pkh} / ${bchVectors.p2sh}`
  );

  // ---- BTC WIF round-trip (0x80 -> 'K'/'L' compressed)
  const btcWif = await page.evaluate(() => {
    return window.rodOtc.chains.withChain('BTC', function () {
      const prev = window.coinjs.compressed;
      window.coinjs.compressed = true;
      const w = window.coinjs.privkey2wif('0000000000000000000000000000000000000000000000000000000000000001');
      const back = window.coinjs.wif2privkey(w);
      const addr = window.coinjs.wif2address(w).address;
      window.coinjs.compressed = prev;
      return { wif: w, priv: back.privkey, addr: addr };
    });
  });
  step(
    'BTC WIF encode/decode round-trips and derives the vector address',
    btcWif.wif === 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn'
      && btcWif.priv === '0000000000000000000000000000000000000000000000000000000000000001'
      && btcWif.addr === '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH',
    `${btcWif.wif.slice(0, 12)}… -> ${btcWif.addr}`
  );

  // ---- bech32 must be refused on BCH (no SegWit)
  const bchBech32Refused = await page.evaluate(() => {
    try {
      window.rodOtc.chains.publicKeyToAddress('BCH', '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'bech32');
      return false;
    } catch (e) { return true; }
  });
  step('BCH bech32/SegWit address generation is refused', bchBech32Refused === true);

  // ---- BTC bech32 MUST work (SegWit active)
  const btcBech32Works = await page.evaluate(() => {
    try {
      const addr = window.rodOtc.chains.publicKeyToAddress('BTC', '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'bech32');
      return addr && addr.indexOf('bc1') === 0;
    } catch (e) { return false; }
  });
  step('BTC bech32/SegWit address generation works', btcBech32Works === true);

  // ---- coinjs globals are restored after a DOGE excursion
  const globalsStable = await page.evaluate(() => {
    const snap = () => JSON.stringify([window.coinjs.pub, window.coinjs.priv, window.coinjs.multisig, window.coinjs.bech32.hrp, window.coinjs.activeNetwork]);
    const before = snap();
    window.rodOtc.chains.withChain('DOGE', function () { return window.coinjs.pub; });
    return { before: before, after: snap() };
  });
  step('coinjs globals restored after withChain(DOGE)', globalsStable.before === globalsStable.after, globalsStable.after);

  // ---- coinjs globals are restored after BTC and BCH excursions
  const btcBchGlobalsStable = await page.evaluate(() => {
    const snap = () => JSON.stringify([window.coinjs.pub, window.coinjs.priv, window.coinjs.multisig, window.coinjs.bech32.hrp, window.coinjs.activeNetwork]);
    const before = snap();
    window.rodOtc.chains.withChain('BTC', function () { return window.coinjs.pub; });
    window.rodOtc.chains.withChain('BCH', function () { return window.coinjs.pub; });
    return { before: before, after: snap() };
  });
  step('coinjs globals restored after withChain(BTC) + withChain(BCH)', btcBchGlobalsStable.before === btcBchGlobalsStable.after, btcBchGlobalsStable.after);

  // ---- bech32 must be refused on DOGE
  const bech32Refused = await page.evaluate(() => {
    try {
      window.rodOtc.chains.publicKeyToAddress('DOGE', '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'bech32');
      return false;
    } catch (e) { return true; }
  });
  step('DOGE bech32/SegWit address generation is refused', bech32Refused === true);

  // ---- Dogecoin relay policy arithmetic
  const policy = await page.evaluate(() => {
    const C = window.rodOtc.chains;
    return {
      hardDust: C.getPolicy('DOGE').hardDustSats,
      feeRate: C.getPolicy('DOGE').feeRatePerByte,
      plain: C.minRelayFeeSats('DOGE', 300, [50000000]),
      dusty: C.minRelayFeeSats('DOGE', 300, [500000]),
      twoDusty: C.minRelayFeeSats('DOGE', 300, [500000, 900000]),
      ltc: C.minRelayFeeSats('LTC', 300, [500000]),
      isDust: C.isHardDust('DOGE', 99999),
      notDust: C.isHardDust('DOGE', 100000),
      economicalDoge: C.minEconomicalOutputSats('DOGE'),
      economicalLtc: C.minEconomicalOutputSats('LTC'),
      unknownThrows: (function () {
        try { C.getPolicy('NOPE'); return false; } catch (e) { return true; }
      })()
    };
  });
  step(
    'Dogecoin fee/dust policy arithmetic matches GetDogecoinMinRelayFee',
    policy.hardDust === 100000 && policy.feeRate === 1000
      && policy.plain === 30000 && policy.dusty === 1030000 && policy.twoDusty === 2030000
      && policy.ltc === 300 && policy.isDust === true && policy.notDust === false
      && policy.economicalDoge === 1000000 && policy.economicalLtc === 546
      && policy.unknownThrows === true,
    `300B plain=${policy.plain} 1×softdust=${policy.dusty} 2×softdust=${policy.twoDusty} · min economical DOGE=${policy.economicalDoge} LTC=${policy.economicalLtc} · unknown chain throws=${policy.unknownThrows}`
  );

  // ---- BTC and BCH relay policy arithmetic
  const btcBchPolicy = await page.evaluate(() => {
    const C = window.rodOtc.chains;
    return {
      btcHardDust: C.getPolicy('BTC').hardDustSats,
      btcFeeRate: C.getPolicy('BTC').feeRatePerByte,
      btcRelay: C.minRelayFeeSats('BTC', 300, [500000]),
      btcIsDust: C.isHardDust('BTC', 545),
      btcNotDust: C.isHardDust('BTC', 546),
      btcBlockSeconds: C.getPolicy('BTC').blockSeconds,
      bchHardDust: C.getPolicy('BCH').hardDustSats,
      bchFeeRate: C.getPolicy('BCH').feeRatePerByte,
      bchRelay: C.minRelayFeeSats('BCH', 300, [500000]),
      bchIsDust: C.isHardDust('BCH', 545),
      bchNotDust: C.isHardDust('BCH', 546),
      bchBlockSeconds: C.getPolicy('BCH').blockSeconds,
      economicalBtc: C.minEconomicalOutputSats('BTC'),
      economicalBch: C.minEconomicalOutputSats('BCH')
    };
  });
  step(
    'BTC and BCH fee/dust policy arithmetic is correct',
    btcBchPolicy.btcHardDust === 546 && btcBchPolicy.btcFeeRate === 2
      && btcBchPolicy.btcRelay === 300 && btcBchPolicy.btcIsDust === true && btcBchPolicy.btcNotDust === false
      && btcBchPolicy.btcBlockSeconds === 600
      && btcBchPolicy.bchHardDust === 546 && btcBchPolicy.bchFeeRate === 2
      && btcBchPolicy.bchRelay === 300 && btcBchPolicy.bchIsDust === true && btcBchPolicy.bchNotDust === false
      && btcBchPolicy.bchBlockSeconds === 600
      && btcBchPolicy.economicalBtc === 546 && btcBchPolicy.economicalBch === 546,
    `BTC dust=${btcBchPolicy.btcHardDust} fee=${btcBchPolicy.btcFeeRate}/B relay(300B)=${btcBchPolicy.btcRelay} block=${btcBchPolicy.btcBlockSeconds}s · BCH dust=${btcBchPolicy.bchHardDust} fee=${btcBchPolicy.bchFeeRate}/B relay(300B)=${btcBchPolicy.bchRelay} block=${btcBchPolicy.bchBlockSeconds}s`
  );

  // ---- per-chain settlement fees
  const fees = await page.evaluate(() => ({
    ltc: window.rodOtc.swap.altFees('LTC'),
    doge: window.rodOtc.swap.altFees('DOGE'),
    btc: window.rodOtc.swap.altFees('BTC'),
    bch: window.rodOtc.swap.altFees('BCH'),
    unregisteredThrows: (function () {
      try { window.rodOtc.swap.altFees('UNKNOWN_CHAIN'); return false; } catch (e) { return true; }
    })()
  }));
  step(
    'alt-chain settlement fees are per-chain, explicit, and clear each relay floor',
    fees.ltc.claimFee === '0.00001000' && fees.doge.claimFee === '0.01000000'
      && fees.doge.refundFee === '0.01000000' && fees.doge.fundingFee === '0.01000000'
      && fees.btc.claimFee === '0.00005000' && fees.btc.refundFee === '0.00005000'
      && fees.bch.claimFee === '0.00001000' && fees.bch.refundFee === '0.00001000'
      && fees.unregisteredThrows === true,
    `LTC ${fees.ltc.claimFee} · DOGE ${fees.doge.claimFee} · BTC ${fees.btc.claimFee} · BCH ${fees.bch.claimFee} · unregistered chain throws=${fees.unregisteredThrows}`
  );

  // ---- settlement policy assertions actually reject bad transactions
  const policyGuards = await page.evaluate(() => {
    const E = window.rodOtc.engine;
    function throws(fn) { try { fn(); return false; } catch (e) { return String(e.message || e); } }
    const size = E.estimateP2shMultisigTxBytes(1, 1);
    return {
      size: size,
      // 305-byte DOGE claim paying only 30,000 koinu (under the 30,600 floor)
      underpaid: throws(() => E.assertSettlementPolicy('DOGE', size, 30000, [50000000], 'claim')),
      // output below the 100,000 koinu hard dust limit
      dusty: throws(() => E.assertSettlementPolicy('DOGE', size, 1000000, [99999], 'claim')),
      // soft-dust output must attract the 0.01 DOGE surcharge in the minimum
      softDustUnderpaid: throws(() => E.assertSettlementPolicy('DOGE', size, 900000, [500000], 'claim')),
      // a correctly-priced DOGE claim must pass
      ok: throws(() => E.assertSettlementPolicy('DOGE', size, 1000000, [50000000], 'claim')),
      // and the existing LTC settlement must still pass unchanged
      ltcOk: throws(() => E.assertSettlementPolicy('LTC', size, 1000, [4999000], 'claim')),
      // BTC settlement at 5000 sats must pass
      btcOk: throws(() => E.assertSettlementPolicy('BTC', size, 5000, [995000], 'claim')),
      // BTC under relay floor must fail
      btcUnderpaid: throws(() => E.assertSettlementPolicy('BTC', size, 200, [995000], 'claim')),
      // BTC dust must fail
      btcDusty: throws(() => E.assertSettlementPolicy('BTC', size, 5000, [545], 'claim')),
      // BCH settlement at 1000 sats must pass
      bchOk: throws(() => E.assertSettlementPolicy('BCH', size, 1000, [999000], 'claim')),
      // BCH dust must fail
      bchDusty: throws(() => E.assertSettlementPolicy('BCH', size, 1000, [545], 'claim'))
    };
  });
  step(
    'settlement policy rejects underpaid and dust transactions on all chains',
    policyGuards.underpaid && policyGuards.dusty && policyGuards.softDustUnderpaid
      && policyGuards.ok === false && policyGuards.ltcOk === false
      && policyGuards.btcOk === false && policyGuards.btcUnderpaid && policyGuards.btcDusty
      && policyGuards.bchOk === false && policyGuards.bchDusty,
    `est ${policyGuards.size}B · DOGE: underpaid=${!!policyGuards.underpaid} dust=${!!policyGuards.dusty} · BTC: ok=${!policyGuards.btcOk} underpaid=${!!policyGuards.btcUnderpaid} dust=${!!policyGuards.btcDusty} · BCH: ok=${!policyGuards.bchOk} dust=${!!policyGuards.bchDusty}`
  );

  // ---- THE core safety invariant of the refund protocol.
  // Alice holds the adaptor secret and funds ROD first. If her ROD refund
  // could mature BEFORE Bob's alt-leg refund, she could reclaim her ROD and
  // still claim the alt coin with the secret — stealing both legs. The
  // protocol's protection is purely a wall-clock ordering, and each chain
  // expresses it in its own block count, so the defaults must be checked in
  // SECONDS, not blocks. This is the one assertion that would silently fail
  // if someone added a chain and copied Litecoin's block count.
  const refundOrdering = await page.evaluate(() => {
    const E = window.rodOtc.engine;
    const C = window.rodOtc.chains;
    const cfg = E.loadConfig();
    const rodSeconds = (cfg.refundRodBlocks || 480) * C.getPolicy('ROD').blockSeconds;
    const out = { rodSeconds: rodSeconds, chains: {} };
    for (const code in window.coinjs.networks) {
      if (code === 'ROD') continue;
      const chainCfg = E.altChainConfig(code, cfg);
      out.chains[code] = {
        blocks: chainCfg.refundBlocks,
        seconds: chainCfg.refundBlocks * C.getPolicy(code).blockSeconds,
        confirmations: chainCfg.confirmations,
        confirmSeconds: chainCfg.confirmations * C.getPolicy(code).blockSeconds
      };
    }
    return out;
  });
  const orderingOk = Object.keys(refundOrdering.chains).every((code) => {
    const c = refundOrdering.chains[code];
    // alt refund must mature well before the ROD refund, and the confirmation
    // wait must fit comfortably inside the alt refund window
    return c.seconds < refundOrdering.rodSeconds && c.confirmSeconds * 4 < c.seconds;
  });
  step(
    'refund windows: every alt leg expires before the ROD leg in WALL-CLOCK time',
    orderingOk,
    `ROD ${refundOrdering.rodSeconds}s · ` +
      Object.keys(refundOrdering.chains)
        .map((c) => `${c} ${refundOrdering.chains[c].blocks}blk=${refundOrdering.chains[c].seconds}s (confirm ${refundOrdering.chains[c].confirmSeconds}s)`)
        .join(' · ')
  );

  // ---- alt-chain terms are cryptographically bound into termsHash
  const binding = await page.evaluate(() => {
    const S = window.rodOtc.swap;
    const base = {
      swapId: 'a'.repeat(64), orderId: 'o', rodAmount: '100.00000000', altAmount: '5.00000000',
      childIndex: 7, releaseRodHeight: 500002,
      aliceChildPubKey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      bobChildPubKey: '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
      sellerAltPayoutAddress: 'x', buyerRodPayoutAddress: 'y',
      refundRodHeight: 500030, altRefundLockHeight: 500060
    };
    const ltc = S.buildTerms(Object.assign({}, base, { altChain: 'LTC' }));
    const doge = S.buildTerms(Object.assign({}, base, { altChain: 'DOGE' }));
    const btc = S.buildTerms(Object.assign({}, base, { altChain: 'BTC' }));
    const bch = S.buildTerms(Object.assign({}, base, { altChain: 'BCH' }));
    return {
      ltcHash: ltc.termsHash, dogeHash: doge.termsHash,
      btcHash: btc.termsHash, bchHash: bch.termsHash,
      ltcPair: ltc.pair, dogePair: doge.pair, btcPair: btc.pair, bchPair: bch.pair,
      ltcMultisig: ltc.altFunding.multisigAddress, dogeMultisig: doge.altFunding.multisigAddress,
      btcMultisig: btc.altFunding.multisigAddress, bchMultisig: bch.altFunding.multisigAddress,
      dogeClaimFee: doge.altClaimFee, ltcClaimFee: ltc.altClaimFee,
      btcClaimFee: btc.altClaimFee, bchClaimFee: bch.altClaimFee,
      dogeRefundAddr: doge.buyerAltRefundAddress,
      btcRefundAddr: btc.buyerAltRefundAddress, bchRefundAddr: bch.buyerAltRefundAddress
    };
  });
  step(
    'altChain is bound into termsHash (a peer cannot swap the chain under a signature)',
    binding.ltcHash !== binding.dogeHash
      && binding.btcHash !== binding.ltcHash && binding.bchHash !== binding.btcHash
      && binding.bchHash !== binding.ltcHash && binding.bchHash !== binding.dogeHash
      && binding.dogePair === 'ROD/DOGE' && binding.ltcPair === 'ROD/LTC'
      && binding.btcPair === 'ROD/BTC' && binding.bchPair === 'ROD/BCH'
      && binding.ltcMultisig !== binding.dogeMultisig
      && binding.dogeMultisig.charAt(0) === '9'
      && binding.dogeRefundAddr.charAt(0) === 'D'
      && binding.btcMultisig.charAt(0) === '3'
      && binding.bchMultisig.charAt(0) === '3'
      /* BTC and BCH share version bytes, so legacy P2SH addresses are identical */
      && binding.btcMultisig === binding.bchMultisig
      && binding.btcRefundAddr.charAt(0) === '1'
      && binding.bchRefundAddr.charAt(0) === '1'
      && binding.dogeClaimFee === '0.01000000' && binding.ltcClaimFee === '0.00001000'
      && binding.btcClaimFee === '0.00005000' && binding.bchClaimFee === '0.00001000',
    `LTC ${binding.ltcHash.slice(0, 12)}… · DOGE ${binding.dogeHash.slice(0, 12)}… · BTC ${binding.btcHash.slice(0, 12)}… · BCH ${binding.bchHash.slice(0, 12)}…`
  );

  // ---- REGRESSION: the swap-creation dust gate must agree with the gate that
  // signing applies. Creation previously validated against the HARD dust limit
  // while assertSettlementPolicy required the output to clear the SOFT limit,
  // so a DOGE swap of 0.011-0.02 passed creation and then stalled forever at
  // refund signing with no way to recover. For every registered alt chain, the
  // smallest amount creation accepts must still produce a signable settlement.
  const gateAgreement = await page.evaluate(() => {
    const C = window.rodOtc.chains;
    const S = window.rodOtc.swap;
    const E = window.rodOtc.engine;
    const size = E.estimateP2shMultisigTxBytes(1, 1);
    const out = {};
    for (const code in S.ALT_CHAIN_FEES) {
      const minOut = C.minEconomicalOutputSats(code);
      const fee = C.decimalToSats(S.altFees(code).claimFee);
      let signable = true, err = '';
      try {
        E.assertSettlementPolicy(code, size, fee, [minOut], 'claim');
      } catch (e) { signable = false; err = String(e.message || e); }
      out[code] = { minOut: minOut, fee: fee, signable: signable, err: err };
    }
    return out;
  });
  const gateOk = Object.keys(gateAgreement).every((c) => gateAgreement[c].signable);
  step(
    'swap-creation dust gate agrees with the settlement-signing gate on every chain',
    gateOk,
    Object.keys(gateAgreement)
      .map((c) => `${c} minOut=${gateAgreement[c].minOut} fee=${gateAgreement[c].fee}${gateAgreement[c].signable ? '' : ' FAIL:' + gateAgreement[c].err}`)
      .join(' · ')
  );

  // ---- REGRESSION: concurrent identical GETs must collapse to one request.
  // coinjs.ajax has no error channel -- it invokes its success callback with
  // the body of a 4xx, a 5xx or a timeout -- so the time-based cache this
  // replaced could pin a failed response for its full TTL. Coalescing shares a
  // response only while its request is still in flight, so it can never serve
  // a value that was already stale, or a failure, to a later caller.
  // Runs in its own page with the route registered BEFORE navigation.
  const probePage = await browser.newPage();
  let hits = 0;
  await probePage.route('**/probe-tip/**', async (route) => {
    hits++;
    await new Promise((r) => setTimeout(r, 150)); // hold it open so calls overlap
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ height: 4242 }) });
  });
  await probePage.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await probePage.waitForFunction(() => window.coinjs && window.coinjs.explorer, null, { timeout: 30000 });
  const coalesced = await probePage.evaluate(async (port) => {
    const net = { code: 'PROBE', apiType: 'blockcypher', apiBase: 'http://127.0.0.1:' + port + '/probe-tip/main' };
    const results = await Promise.all([
      window.coinjs.explorer.tipHeight(net),
      window.coinjs.explorer.tipHeight(net),
      window.coinjs.explorer.tipHeight(net)
    ]);
    // a later, non-overlapping call must hit the network again (no stale cache)
    const later = await window.coinjs.explorer.tipHeight(net);
    return { results: results, later: later };
  }, PORT);
  step(
    'concurrent identical explorer GETs coalesce; sequential ones do not go stale',
    hits === 2 && coalesced.results.join(',') === '4242,4242,4242' && coalesced.later === 4242,
    `3 concurrent + 1 later = ${hits} network request(s) (expected 2)`
  );
  // ---- Blockchair driver field mapping. Nothing in production reads tx.vin
  // yet, so the e2e matrix cannot catch a mis-mapped prevout: Blockchair
  // returns each input as the OUTPUT RECORD being spent, where
  // transaction_hash/index are the prevout and spending_* refer to the tx
  // being viewed. Reading spending_transaction_hash as the prevout makes every
  // vin point at itself, which stays invisible until something walks the graph.
  // Own page, route registered BEFORE navigation — registering a route on an
  // already-navigated page races with in-flight loads and intermittently lets
  // the request fall through to the static server (which answers 'nope').
  const bchairPage = await browser.newPage();
  await bchairPage.route('**/probe-bchair/**', async (route) => {
    const url = route.request().url();
    const txid = 'bb'.repeat(32);
    if (url.indexOf('/dashboards/transaction/') !== -1) {
      const data = {};
      data[txid] = {
        transaction: { hash: txid, block_id: 700000, version: 2, lock_time: 0, size: 306, fee: 1000 },
        inputs: [{
          transaction_hash: 'aa'.repeat(32), index: 3,
          spending_transaction_hash: txid, spending_index: 0,
          spending_signature_hex: 'deadbeef', spending_sequence: 4294967294,
          value: 999000, recipient: 'prevaddr'
        }],
        outputs: [
          { value: 500000, script_hex: '76a914', recipient: 'out0', spending_transaction_hash: 'cc'.repeat(32) },
          { value: 498000, script_hex: '76a915', recipient: 'out1', spending_transaction_hash: '' }
        ]
      };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"data":null}' });
  });
  await bchairPage.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await bchairPage.waitForFunction(() => window.coinjs && window.coinjs.explorer, null, { timeout: 30000 });
  const bchair = await bchairPage.evaluate(async (port) => {
    const net = { code: 'BCHPROBE', apiType: 'blockchair', apiBase: 'http://127.0.0.1:' + port + '/probe-bchair' };
    const txid = 'bb'.repeat(32);
    const tx = await window.coinjs.explorer.tx(net, txid);
    const spent = await window.coinjs.explorer.outspend(net, txid, 0);
    const unspent = await window.coinjs.explorer.outspend(net, txid, 1);
    return {
      vinTxid: tx.vin[0].txid, vinVout: tx.vin[0].vout,
      vinValue: tx.vin[0].prevout.value, vinAddr: tx.vin[0].prevout.scriptpubkey_address,
      outValue: tx.vout[0].value, outAddr: tx.vout[0].scriptpubkey_address,
      confirmed: tx.status.confirmed, height: tx.status.block_height,
      spent0: spent.spent, spent0Txid: spent.txid, spent1: unspent.spent
    };
  }, PORT);
  step(
    'blockchair driver maps prevout, outputs and outspend into the Esplora shape',
    bchair.vinTxid === 'aa'.repeat(32) && bchair.vinVout === 3
      && bchair.vinValue === 999000 && bchair.vinAddr === 'prevaddr'
      && bchair.outValue === 500000 && bchair.outAddr === 'out0'
      && bchair.confirmed === true && bchair.height === 700000
      && bchair.spent0 === true && bchair.spent0Txid === 'cc'.repeat(32)
      && bchair.spent1 === false,
    `vin=${bchair.vinTxid.slice(0, 8)}…:${bchair.vinVout} · outspend(0)=${bchair.spent0} outspend(1)=${bchair.spent1}`
  );
  await bchairPage.close();

  await probePage.close();

  await browser.close();
  await new Promise((r) => app.close(r));

  console.log('\n================= UNIT RESULT =================');
  console.log(results.ok ? 'ALL UNIT CHECKS PASSED ✓' : 'UNIT CHECKS FAILED ✗');
  process.exit(results.ok ? 0 : 1);
}

main().catch((e) => { console.error('UNIT HARNESS ERROR:', e); process.exit(1); });
