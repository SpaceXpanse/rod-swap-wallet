(function(){
	var root = window.rodOtc = window.rodOtc || {};
	var nostrModule = root.nostr = root.nostr || {};
	var MESSAGE_TYPES = {
		swap_accept: true,
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
		swap_complete: true
	};

	function canonicalEvent(eventObject){
		return [0, eventObject.pubkey || '', eventObject.created_at || 0, eventObject.kind || 33440, eventObject.tags || [], eventObject.content || ''];
	}

	function computeEventId(eventObject){
		return Crypto.util.bytesToHex(Crypto.SHA256(Crypto.charenc.UTF8.stringToBytes(JSON.stringify(canonicalEvent(eventObject))), {asBytes: true}));
	}

	nostrModule.createEnvelope = function(input){
		var payload = input.payload || {};
		var envelope = {
			version: 1,
			swapId: input.swapId,
			type: input.type,
			sequence: input.sequence,
			previousEventId: input.previousEventId || '',
			payload: payload
		};
		var event = {
			pubkey: input.pubkey || 'manual-otc-peer',
			created_at: input.createdAt || Math.floor((new Date()).getTime() / 1000),
			kind: 33440,
			tags: [
				['swapId', input.swapId],
				['type', input.type],
				['sequence', String(input.sequence)]
			],
			content: JSON.stringify(envelope)
		};
		event.id = computeEventId(event);
		return event;
	};

	nostrModule.validateEnvelope = function(eventObject){
		if(!eventObject || !eventObject.content || !eventObject.id){
			throw new Error('Incomplete OTC Nostr envelope');
		}
		if(computeEventId(eventObject) !== eventObject.id){
			throw new Error('OTC Nostr envelope ID mismatch');
		}
		var envelope = JSON.parse(eventObject.content);
		if(envelope.version !== 1 || !MESSAGE_TYPES[envelope.type] || !envelope.swapId || typeof envelope.sequence !== 'number'){
			throw new Error('Unsupported OTC Nostr payload');
		}
		return envelope;
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
		var compressed = coinjs.compressed;
		coinjs.compressed = true;
		var pubkey;
		try {
			pubkey = coinjs.newPubkey(decoded.privkey);
		} finally {
			coinjs.compressed = compressed;
		}
		var xOnly = normalizePubkeyHex(pubkey);
		return {
			privateKeyHex: decoded.privkey,
			publicKeyHex: xOnly,
			pubkey: xOnly,
			npub: nostrModule.encodeNpub(xOnly)
		};
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
		var event = nostrModule.createEnvelope({
			swapId: 'nostr-fixture-swap',
			type: 'swap_terms',
			sequence: 2,
			payload: { pair: 'ROD/LTC', releaseRodHeight: 1500000 },
			pubkey: 'fixture-nostr-peer'
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
			passed: !!imported && tamperRejected,
			eventId: event.id,
			tamperRejected: tamperRejected
		};
	};
})();
