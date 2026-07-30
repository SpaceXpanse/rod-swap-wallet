#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(process.env.APP_DIR || path.join(__dirname, '..'));
const values = new Map();
const localStorage = {
	getItem(key) { return values.has(key) ? values.get(key) : null; },
	setItem(key, value) { values.set(key, String(value)); },
	removeItem(key) { values.delete(key); }
};
const context = {
	console,
	document: { location: { protocol: 'http:', hostname: 'localhost' } },
	localStorage,
	navigator: {},
	setTimeout,
	clearTimeout,
	Uint8Array,
	window: null
};
context.window = context;
context.crypto = {
	getRandomValues(target) {
		crypto.randomFillSync(target);
		return target;
	}
};
vm.createContext(context);

[
	'js/crypto-min.js',
	'js/crypto-sha256.js',
	'js/crypto-sha256-hmac.js',
	'js/sha512.js',
	'js/ripemd160.js',
	'js/jsbn.js',
	'js/ellipticcurve.js',
	'js/coin.js',
	'js/ecdsa-adaptor.js',
	'js/otc-chains.js',
	'js/otc-storage.js',
	'js/otc-nostr.js',
	'js/otc-swap.js'
].forEach((relativePath) => {
	const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
	vm.runInContext(source, context, { filename: relativePath });
});

const NOSTR = context.rodOtc.nostr;
const SWAP = context.rodOtc.swap;
const CHAINS = context.rodOtc.chains;
const ADAPTOR = context.rodOtc.adaptor;

function expectThrow(fn, pattern, label) {
	let thrown = null;
	try { fn(); } catch (error) { thrown = error; }
	assert(thrown, label + ': expected an exception');
	assert(pattern.test(String(thrown.message || thrown)), label + ': unexpected error "' + thrown + '"');
}

function signedFixture(privateKeyHex, type) {
	return NOSTR.createEnvelope({
		swapId: 'security-regression-swap',
		type: type || 'swap_terms',
		sequence: 1,
		payload: { test: true },
		privateKeyHex,
		createdAt: 1700000000,
		auxiliaryRandomnessHex: '00'.repeat(32)
	});
}

function testNostrSignatures() {
	const valid = signedFixture('03'.padStart(64, '0'));
	assert.strictEqual(NOSTR.validateEnvelope(valid).type, 'swap_terms', 'valid signed swap event must pass');

	const unsigned = JSON.parse(JSON.stringify(valid));
	delete unsigned.sig;
	expectThrow(
		() => NOSTR.validateEnvelope(unsigned),
		/signature/i,
		'unsigned swap event'
	);

	expectThrow(
		() => NOSTR.createEnvelope({
			swapId: 'security-regression-swap',
			type: 'swap_accept',
			sequence: 2,
			payload: { accepted: true },
			pubkey: valid.pubkey
		}),
		/private key|sign/i,
		'unsigned event creation'
	);

	const contentTampered = JSON.parse(JSON.stringify(valid));
	contentTampered.content = JSON.stringify({ version: 1, swapId: valid.swapId, type: 'swap_complete', sequence: 99 });
	expectThrow(() => NOSTR.validateEnvelope(contentTampered), /ID mismatch/i, 'tampered event content');

	const signatureTampered = JSON.parse(JSON.stringify(valid));
	signatureTampered.sig = '00'.repeat(64);
	expectThrow(() => NOSTR.validateEnvelope(signatureTampered), /signature/i, 'tampered event signature');

	const signerTampered = JSON.parse(JSON.stringify(valid));
	signerTampered.pubkey = NOSTR.identityFromPrivateKey('04'.padStart(64, '0')).pubkey;
	expectThrow(() => NOSTR.validateEnvelope(signerTampered), /ID mismatch|signature/i, 'substituted event signer');

	const kindTampered = JSON.parse(JSON.stringify(valid));
	kindTampered.kind = 1;
	expectThrow(() => NOSTR.validateEnvelope(kindTampered), /unsupported.*kind/i, 'unsupported event kind');
}

function testOrderEventAuthentication() {
	const privateKeyHex = '05'.padStart(64, '0');
	const event = NOSTR.createOrderEvent({
		order: {
			orderId: 'security-order',
			pair: 'ROD/DOGE',
			side: 'sell',
			give: '10.00000000',
			want: '20.00000000'
		},
		privateKeyHex,
		createdAt: 1700000000,
		auxiliaryRandomnessHex: '00'.repeat(32)
	});
	assert.strictEqual(NOSTR.validateOrderEvent(event).order.orderId, 'security-order');

	const unsigned = JSON.parse(JSON.stringify(event));
	delete unsigned.sig;
	expectThrow(() => NOSTR.validateOrderEvent(unsigned), /signature/i, 'unsigned order event');

	const tampered = JSON.parse(JSON.stringify(event));
	const envelope = JSON.parse(tampered.content);
	envelope.order.want = '2000.00000000';
	tampered.content = JSON.stringify(envelope);
	expectThrow(() => NOSTR.validateOrderEvent(tampered), /ID mismatch/i, 'tampered order economics');

	const identityMismatch = JSON.parse(JSON.stringify(event));
	const body = JSON.parse(identityMismatch.content);
	body.order.nostrPubkey = NOSTR.identityFromPrivateKey('06'.padStart(64, '0')).pubkey;
	identityMismatch.content = JSON.stringify(body);
	expectThrow(() => NOSTR.validateOrderEvent(identityMismatch), /ID mismatch|identity/i, 'order identity substitution');
}

function testNostrIdentityBinding() {
	const remoteKey = '03'.padStart(64, '0');
	const attackerKey = '04'.padStart(64, '0');
	const remote = NOSTR.identityFromPrivateKey(remoteKey);
	const attacker = NOSTR.identityFromPrivateKey(attackerKey);
	const evenAddress = CHAINS.publicKeyToAddress('ROD', '02' + remote.pubkey, 'legacy');
	const oddAddress = CHAINS.publicKeyToAddress('ROD', '03' + remote.pubkey, 'legacy');
	const remoteAddress = [evenAddress, oddAddress].find((address) =>
		SWAP.nostrPubkeyMatchesRodIdentity(remote.pubkey, address)
	);
	assert(remoteAddress, 'one compressed-key parity must reproduce the remote ROD identity');
	assert.strictEqual(SWAP.nostrPubkeyMatchesRodIdentity(remote.pubkey, remoteAddress), true);
	assert.strictEqual(SWAP.nostrPubkeyMatchesRodIdentity(attacker.pubkey, remoteAddress), false);
}

function testTermsHashHardFailure() {
	const local = { termsHash: '11'.repeat(32) };
	const identicalRemote = { termsHash: local.termsHash };
	assert.strictEqual(SWAP.assertMatchingTermsHash(local, identicalRemote), true);
	expectThrow(
		() => SWAP.assertMatchingTermsHash(local, { termsHash: '22'.repeat(32) }),
		/terms hash/i,
		'mismatched canonical terms'
	);
	expectThrow(
		() => SWAP.assertMatchingTermsHash(local, {}),
		/terms hash/i,
		'missing remote terms hash'
	);
	assert.strictEqual(
		SWAP.assertMatchingTermsHash(local, { termsHash: local.termsHash.toUpperCase() }),
		true,
		'hex case must not create a false mismatch'
	);
	expectThrow(
		() => SWAP.assertMatchingTermsHash({ termsHash: '1'.repeat(63) }, { termsHash: '1'.repeat(63) }),
		/terms hash/i,
		'truncated matching hashes'
	);

	const uiSource = fs.readFileSync(path.join(root, 'js/otc-app-ui.js'), 'utf8');
	assert(!/session\.terms\s*=\s*\$\.extend\(true,\s*\{\},\s*terms\)/.test(uiSource),
		'incoming UI must never replace locally reconstructed terms with remote terms');
	assert(/SWAP\.assertMatchingTermsHash\(session\.terms,\s*terms\)/.test(uiSource),
		'incoming UI must call the canonical terms-hash gate');
}

function testRefundOrdering() {
	const validLtc = {
		altChain: 'LTC',
		refundRodHeight: 100480,
		altRefundLockHeight: 200024,
		rodConfirmations: 1,
		altConfirmations: 1
	};
	const validDoge = {
		altChain: 'DOGE',
		refundRodHeight: 100480,
		altRefundLockHeight: 300060,
		rodConfirmations: 1,
		altConfirmations: 6
	};
	const ltc = SWAP.assertRefundOrdering(validLtc, 100000, 200000);
	const doge = SWAP.assertRefundOrdering(validDoge, 100000, 300000);
	assert(ltc.rodRemainingSeconds > ltc.altRemainingSeconds + ltc.safetyMarginSeconds);
	assert(doge.rodRemainingSeconds > doge.altRemainingSeconds + doge.safetyMarginSeconds);

	expectThrow(
		() => SWAP.assertRefundOrdering({
			altChain: 'LTC',
			refundRodHeight: 100120,
			altRefundLockHeight: 200120,
			rodConfirmations: 1,
			altConfirmations: 1
		}, 100000, 200000),
		/refund ordering/i,
		'later alt-chain refund'
	);

	expectThrow(
		() => SWAP.assertRefundOrdering({
			altChain: 'DOGE',
			refundRodHeight: 100480,
			altRefundLockHeight: 300470,
			rodConfirmations: 1,
			altConfirmations: 6
		}, 100000, 300000),
		/refund ordering/i,
		'DOGE wall-clock reversal'
	);

	expectThrow(
		() => SWAP.assertRefundOrdering({
			altChain: 'LTC',
			refundRodHeight: 100140,
			altRefundLockHeight: 200016,
			rodConfirmations: 1,
			altConfirmations: 1
		}, 100000, 200000),
		/refund ordering/i,
		'exact safety-margin boundary must fail because action time must remain'
	);
	expectThrow(
		() => SWAP.assertRefundOrdering(validLtc, 100480, 200000),
		/future lock heights/i,
		'expired ROD refund'
	);
	expectThrow(
		() => SWAP.assertRefundOrdering(Object.assign({}, validLtc, { altChain: 'DGB' }), 100000, 200000),
		/unsupported alt chain/i,
		'wallet-only chain used as swap counter chain'
	);
}

function testRuntimeBoundaryWiring() {
	const uiSource = fs.readFileSync(path.join(root, 'js/otc-app-ui.js'), 'utf8');
	const engineSource = fs.readFileSync(path.join(root, 'js/otc-engine.js'), 'utf8');
	const incomingCheck = uiSource.indexOf('SWAP.assertRefundOrdering(terms, freshTips.rodHeight, freshTips.altHeight)');
	const incomingCreate = uiSource.indexOf('var session = SWAP.createOfferSession({', incomingCheck);
	assert(incomingCheck !== -1 && incomingCreate > incomingCheck,
		'incoming terms must pass refund ordering before a session is created');
	assert(/function acceptSession[\s\S]*?return validateRefundOrderingFresh\(session\)\.then/.test(uiSource),
		'local acceptance must wait for fresh refund-ordering validation');
	assert(/ensureRefundSafetyGate\(latest, 'preFunding'\)/.test(uiSource),
		'refund signing pipeline must have a fresh ordering gate');
	assert(/ensureRefundSafetyGate\(latest, 'funding'\)/.test(uiSource),
		'funding broadcast pipeline must have a fresh ordering gate');

	const globalPeerGate = uiSource.indexOf('ensureRemotePeer(sess, eventObject);', uiSource.indexOf('function autoProcess'));
	const adaptorHandler = uiSource.indexOf("if (env.type === 'swap_adaptor_point'", globalPeerGate);
	assert(globalPeerGate !== -1 && adaptorHandler > globalPeerGate,
		'signer identity must be bound before the first swap payload handler');
	const envelopeValidation = engineSource.indexOf('var env = NOSTR.validateEnvelope(ev);');
	const messageDispatch = engineSource.indexOf('engine.onSwapMessage(env, ev);', envelopeValidation);
	assert(envelopeValidation !== -1 && messageDispatch > envelopeValidation,
		'envelope signature validation must precede runtime message dispatch');
}

function testPreservedProtocolBehavior() {
	const results = [
		NOSTR.testValidation(),
		CHAINS.testAgainstRodGlobals(),
		ADAPTOR.testVectors(),
		SWAP.testFixtures()
	];
	for (const result of results) {
		assert.strictEqual(result.passed, true, (result.name || 'protocol fixture') + ' must remain green');
	}
}

function testBilateralTermsReconstruction() {
	localStorage.removeItem('rodOtcState');
	const seller = SWAP.createSwapAccount('security seller fixture');
	const buyer = SWAP.createSwapAccount('security buyer fixture');
	const swapId = SWAP.swapIdFromOrder('security/order', '1', 'seller', 'buyer', 'nonce');
	const childIndex = SWAP.childIndexFromSwapId(swapId);
	const sellerKeys = SWAP.deriveSwapKeys(seller.xpub, childIndex);
	const buyerKeys = SWAP.deriveSwapKeys(buyer.xpub, childIndex);
	const common = {
		swapId,
		orderId: 'security/order',
		altChain: 'DOGE',
		rodAmount: '10.00000000',
		altAmount: '20.00000000',
		sellerSwapXpub: seller.xpub,
		buyerSwapXpub: buyer.xpub,
		releaseRodHeight: 100100,
		sellerAltPayoutAddress: CHAINS.publicKeyToAddress('DOGE', sellerKeys.publicKey, 'legacy'),
		buyerRodPayoutAddress: CHAINS.publicKeyToAddress('ROD', buyerKeys.publicKey, 'legacy'),
		sellerIdentity: 'seller',
		buyerIdentity: 'buyer',
		termsNonce: 'nonce',
		refundRodHeight: 100480,
		altRefundLockHeight: 300060,
		rodConfirmations: 1,
		altConfirmations: 6
	};
	const sender = SWAP.createOfferSession(Object.assign({
		role: 'seller',
		sellerSwapAccountKey: seller.xprv,
		buyerSwapAccountKey: buyer.xpub
	}, common));
	const receiver = SWAP.createOfferSession(Object.assign({
		role: 'buyer',
		sellerSwapAccountKey: seller.xpub,
		buyerSwapAccountKey: buyer.xprv
	}, common));
	assert.strictEqual(receiver.localChildPublicKey, sender.remoteChildPublicKey,
		'receiver must derive the same local child public key');
	assert.strictEqual(receiver.terms.termsHash, sender.terms.termsHash,
		'legitimate sender and receiver must reconstruct the same canonical terms hash');
}

const tests = [
	['Nostr signatures', testNostrSignatures],
	['Nostr order-event authentication', testOrderEventAuthentication],
	['Nostr identity binding', testNostrIdentityBinding],
	['terms hash hard failure', testTermsHashHardFailure],
	['refund ordering for LTC and DOGE', testRefundOrdering],
	['runtime security boundary wiring', testRuntimeBoundaryWiring],
	['preserved protocol and DOGE vectors', testPreservedProtocolBehavior],
	['bilateral canonical terms reconstruction', testBilateralTermsReconstruction]
];

let passed = 0;
for (const [name, test] of tests) {
	try {
		test();
		passed += 1;
		console.log('PASS ' + name);
	} catch (error) {
		console.error('FAIL ' + name + ': ' + (error.stack || error));
		process.exitCode = 1;
	}
}
console.log(passed + '/' + tests.length + ' security regression groups passed');
