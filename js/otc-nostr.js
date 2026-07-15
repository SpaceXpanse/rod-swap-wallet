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
