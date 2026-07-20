(function(){
	var root = window.rodOtc = window.rodOtc || {};
	var nostrModule = root.nostr = root.nostr || {};
	/* Stored regular event kind. Do not use 30000-39999 here: those are parameterized replaceable
	   and relays may retain only the latest event per pubkey/kind/d, hiding swap_terms from late peers. */
	nostrModule.OTC_EVENT_KIND = 7340;
	nostrModule.LEGACY_OTC_EVENT_KIND = 33440;
	var MESSAGE_TYPES = {
		swap_accept: true,
		swap_decline: true,
		swap_terms: true,
		swap_adaptor_point: true,
		swap_ltc_adaptor_signature: true,
		swap_ltc_normal_signature: true,
		swap_rod_adaptor_signature: true,
		swap_rod_normal_signature: true,
		swap_rod_funded: true,
		swap_ltc_funded: true,
		swap_ready: true,
		swap_ltc_claimed: true,
		swap_secret_recovered: true,
		swap_rod_claimed: true,
		swap_complete: true,
		/* Pre-funding protocol: planned (signed, unbroadcast) funding txids,
		   pre-signed timelocked refund exchange, and the PREPARED gate. */
		swap_rod_funding_planned: true,
		swap_ltc_funding_planned: true,
		swap_rod_refund_signature: true,
		swap_ltc_refund_signature: true,
		swap_prepared: true,
		/* Refund outcome notifications */
		swap_rod_refund_broadcast: true,
		swap_ltc_refund_broadcast: true,
		swap_refunded: true
	};

	function canonicalEvent(eventObject){
		return [0, eventObject.pubkey || '', eventObject.created_at || 0, eventObject.kind || nostrModule.OTC_EVENT_KIND, eventObject.tags || [], eventObject.content || ''];
	}

	function computeEventId(eventObject){
		return Crypto.util.bytesToHex(Crypto.SHA256(Crypto.charenc.UTF8.stringToBytes(JSON.stringify(canonicalEvent(eventObject))), {asBytes: true}));
	}

	function fixedScalarHex(scalarValue){
		var bytes = scalarValue.toByteArrayUnsigned();
		while(bytes.length < 32) bytes.unshift(0);
		if(bytes.length > 32) bytes = bytes.slice(bytes.length - 32);
		return Crypto.util.bytesToHex(bytes);
	}

	function pointXHex(pointValue){
		return fixedScalarHex(pointValue.getX().toBigInteger());
	}

	function hasEvenY(pointValue){
		return pointValue.getY().toBigInteger().isEven();
	}

	function taggedHashHex(tag, hexValues){
		var bytes = [];
		for(var i = 0; i < hexValues.length; i++){
			bytes = bytes.concat(Crypto.util.hexToBytes(hexValues[i]));
		}
		return Crypto.util.bytesToHex(coinjs.taggedHash(tag, bytes));
	}

	function liftX(xHex){
		var ecparams = EllipticCurve.getSECCurveByName('secp256k1');
		var curve = ecparams.getCurve();
		var p = curve.getQ();
		var x = new BigInteger(xHex, 16);
		if(x.compareTo(p) >= 0) throw new Error('Nostr public key x-coordinate is out of range');
		var alpha = x.modPow(new BigInteger('3'), p).add(new BigInteger('7')).mod(p);
		var beta = alpha.modPow(p.add(BigInteger.ONE).divide(new BigInteger('4')), p);
		var y = beta.isEven() ? beta : p.subtract(beta);
		return curve.decodePointHex('04' + fixedScalarHex(x) + fixedScalarHex(y));
	}

	function schnorrSign(messageHashHex, privateKeyHex, auxiliaryRandomnessHex){
		var ecparams = EllipticCurve.getSECCurveByName('secp256k1');
		var n = ecparams.getN();
		var G = ecparams.getG();
		var d0 = new BigInteger(privateKeyHex, 16);
		if(d0.compareTo(BigInteger.ONE) < 0 || d0.compareTo(n) >= 0) throw new Error('Invalid Nostr private key');
		var P = G.multiply(d0);
		var d = hasEvenY(P) ? d0 : n.subtract(d0);
		var px = pointXHex(P);
		var aux = auxiliaryRandomnessHex || Crypto.util.bytesToHex(coinjs.secureRandomBytes(32));
		var auxHash = taggedHashHex('BIP0340/aux', [aux]);
		var privateBytes = Crypto.util.hexToBytes(fixedScalarHex(d));
		var auxBytes = Crypto.util.hexToBytes(auxHash);
		var t = [];
		for(var i = 0; i < 32; i++) t.push(privateBytes[i] ^ auxBytes[i]);
		var k0 = new BigInteger(taggedHashHex('BIP0340/nonce', [Crypto.util.bytesToHex(t), px, messageHashHex]), 16).mod(n);
		if(k0.equals(BigInteger.ZERO)) throw new Error('Invalid Nostr nonce');
		var R = G.multiply(k0);
		var k = hasEvenY(R) ? k0 : n.subtract(k0);
		var rx = pointXHex(R);
		var e = new BigInteger(taggedHashHex('BIP0340/challenge', [rx, px, messageHashHex]), 16).mod(n);
		var s = k.add(e.multiply(d)).mod(n);
		return rx + fixedScalarHex(s);
	}

	function schnorrVerify(messageHashHex, publicKeyHex, signatureHex){
		try {
			if(!/^[0-9a-f]{64}$/i.test(messageHashHex) || !/^[0-9a-f]{64}$/i.test(publicKeyHex) || !/^[0-9a-f]{128}$/i.test(signatureHex)) return false;
			var ecparams = EllipticCurve.getSECCurveByName('secp256k1');
			var n = ecparams.getN();
			var G = ecparams.getG();
			var P = liftX(publicKeyHex);
			var r = new BigInteger(signatureHex.slice(0, 64), 16);
			var s = new BigInteger(signatureHex.slice(64), 16);
			var p = ecparams.getCurve().getQ();
			if(r.compareTo(p) >= 0 || s.compareTo(n) >= 0) return false;
			var e = new BigInteger(taggedHashHex('BIP0340/challenge', [fixedScalarHex(r), publicKeyHex, messageHashHex]), 16).mod(n);
			var R = G.multiply(s).add(P.multiply(e).negate());
			if(R.isInfinity() || !hasEvenY(R)) return false;
			return R.getX().toBigInteger().equals(r);
		} catch(error){
			return false;
		}
	}

		nostrModule.createEnvelope = function(input){
		var payload = input.payload || {};
		var identity = input.privateKeyHex ? nostrModule.identityFromPrivateKey(input.privateKeyHex) : null;
		var pubkey = identity ? identity.pubkey : normalizePubkeyHex(input.pubkey || '');
		if(!pubkey){
			throw new Error('A valid Nostr pubkey is required to publish OTC messages');
		}
		var envelope = {
			version: 1,
			swapId: input.swapId,
			type: input.type,
			sequence: input.sequence,
			previousEventId: input.previousEventId || '',
			payload: payload
		};
		var event = {
			pubkey: pubkey,
			created_at: input.createdAt || Math.floor((new Date()).getTime() / 1000),
			kind: nostrModule.OTC_EVENT_KIND,
			tags: [
				['d', input.swapId],
				['swapId', input.swapId],
				['type', input.type],
				['sequence', String(input.sequence)]
			],
			content: JSON.stringify(envelope)
		};
		event.id = computeEventId(event);
		if(identity){
			event.sig = schnorrSign(event.id, identity.privateKeyHex, input.auxiliaryRandomnessHex);
		}
		return event;
	};

	nostrModule.validateEnvelope = function(eventObject){
		if(!eventObject || !eventObject.content || !eventObject.id){
			throw new Error('Incomplete OTC Nostr envelope');
		}
		if(eventObject.kind !== nostrModule.OTC_EVENT_KIND && eventObject.kind !== nostrModule.LEGACY_OTC_EVENT_KIND){
			throw new Error('Unsupported OTC Nostr event kind ' + eventObject.kind);
		}
		if(computeEventId(eventObject) !== eventObject.id){
			throw new Error('OTC Nostr envelope ID mismatch');
		}
		if(eventObject.sig && !schnorrVerify(eventObject.id, eventObject.pubkey, eventObject.sig)){
			throw new Error('OTC Nostr event signature mismatch');
		}
		var envelope = JSON.parse(eventObject.content);
		if(envelope.version !== 1 || !MESSAGE_TYPES[envelope.type] || !envelope.swapId || typeof envelope.sequence !== 'number'){
			throw new Error('Unsupported OTC Nostr payload');
		}
		return envelope;
	};

	nostrModule.identityFromPrivateKey = function(privateKeyHex){
		var key = String(privateKeyHex || '').toLowerCase().replace(/^0x/, '');
		if(!/^[0-9a-f]{64}$/.test(key)){
			throw new Error('Invalid Nostr private key hex');
		}
		var compressed = coinjs.compressed;
		coinjs.compressed = true;
		var pubkey;
		try {
			pubkey = coinjs.newPubkey(key);
		} finally {
			coinjs.compressed = compressed;
		}
		var xOnly = normalizePubkeyHex(pubkey);
		return {
			privateKeyHex: key,
			publicKeyHex: xOnly,
			pubkey: xOnly,
			npub: nostrModule.encodeNpub(xOnly)
		};
	};

	/* ---- NIP-19 npub helpers (browser-local, no deps) ---- */

	function normalizePubkeyHex(pubkeyHex){
		var hex = String(pubkeyHex || '').toLowerCase().replace(/^0x/, '');
		if(!/^[0-9a-f]+$/.test(hex)){
			return '';
		}
		/* Compressed ECDSA (33 bytes) → x-only (32 bytes) */
		if(hex.length === 66 && (hex.indexOf('02') === 0 || hex.indexOf('03') === 0)){
			return hex.slice(2);
		}
		/* Already x-only Nostr pubkey */
		if(hex.length === 64){
			return hex;
		}
		return '';
	}

	/** Encode 32-byte hex pubkey as npub1… (NIP-19). */
	nostrModule.encodeNpub = function(pubkeyHex){
		var xOnly = normalizePubkeyHex(pubkeyHex);
		if(!xOnly){
			throw new Error('Invalid Nostr public key hex');
		}
		var bytes = Crypto.util.hexToBytes(xOnly);
		if(bytes.length !== 32){
			throw new Error('Nostr public key must be 32 bytes');
		}
		var words = coinjs.bech32_convert(bytes, 8, 5, true);
		return coinjs.bech32_encode('npub', words);
	};

	/**
	 * Derive a deterministic Nostr identity from the open wallet WIF.
	 * Uses the wallet secp256k1 key; npub is the x-only pubkey (NIP-19).
	 */
	nostrModule.identityFromWif = function(wif){
		if(!wif){
			throw new Error('WIF is required for Nostr identity');
		}
		var decoded = coinjs.wif2privkey(wif);
		if(!decoded || !decoded.privkey){
			throw new Error('Invalid WIF for Nostr identity');
		}
		return nostrModule.identityFromPrivateKey(decoded.privkey);
	};

	nostrModule.exportEnvelope = function(eventObject){
		return JSON.stringify(eventObject, null, 2);
	};

	nostrModule.importEnvelope = function(serializedValue){
		var parsedEvent = JSON.parse(serializedValue);
		nostrModule.validateEnvelope(parsedEvent);
		return parsedEvent;
	};

	nostrModule.testValidation = function(){
		var identity = nostrModule.identityFromPrivateKey('0000000000000000000000000000000000000000000000000000000000000003');
		var event = nostrModule.createEnvelope({
			swapId: 'nostr-fixture-swap',
			type: 'swap_terms',
			sequence: 2,
			payload: { pair: 'ROD/LTC', releaseRodHeight: 1500000 },
			privateKeyHex: identity.privateKeyHex,
			auxiliaryRandomnessHex: '0000000000000000000000000000000000000000000000000000000000000000'
		});
		var imported = nostrModule.importEnvelope(JSON.stringify(event));
		var tamperRejected = false;
		try {
			var tampered = JSON.parse(JSON.stringify(event));
			tampered.content = JSON.stringify({ tampered: true });
			nostrModule.validateEnvelope(tampered);
		} catch(error){
			tamperRejected = true;
		}
		return {
			name: 'Manual OTC Nostr envelopes',
			passed: !!imported && !!event.sig && event.pubkey === identity.pubkey && tamperRejected,
			eventId: event.id,
			signed: !!event.sig,
			tamperRejected: tamperRejected
		};
	};
})();
