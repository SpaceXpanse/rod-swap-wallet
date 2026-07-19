(function(){
	var root = window.rodOtc = window.rodOtc || {};
	var swapModule = root.swap = root.swap || {};
	var STORAGE = root.storage;
	var CHAINS = root.chains;
	var NOSTR = root.nostr;
	var ADAPTOR = root.adaptor;
	var ALLOWED_TRANSITIONS = {
		OPEN: ['NEGOTIATING'],
		NEGOTIATING: ['TERMS_ACCEPTED'],
		TERMS_ACCEPTED: ['SIGNATURES_EXCHANGED'],
		SIGNATURES_EXCHANGED: ['ALICE_ROD_FUNDED'],
		ALICE_ROD_FUNDED: ['BOB_LTC_FUNDED'],
		BOB_LTC_FUNDED: ['READY'],
		READY: ['LTC_CLAIMED'],
		LTC_CLAIMED: ['SECRET_RECOVERED'],
		SECRET_RECOVERED: ['ROD_CLAIMED'],
		ROD_CLAIMED: ['COMPLETE'],
		COMPLETE: []
	};

	function stableStringify(value){
		if(value === null || typeof value !== 'object'){
			return JSON.stringify(value);
		}
		if(coinjs.isArray(value)){
			var arrayValues = [];
			for(var arrayIndex = 0; arrayIndex < value.length; arrayIndex++){
				arrayValues.push(stableStringify(value[arrayIndex]));
			}
			return '[' + arrayValues.join(',') + ']';
		}
		var keys = [];
		for(var propertyName in value){
			if(value.hasOwnProperty(propertyName)){
				keys.push(propertyName);
			}
		}
		keys.sort();
		var keyValuePairs = [];
		for(var keyIndex = 0; keyIndex < keys.length; keyIndex++){
			keyValuePairs.push(JSON.stringify(keys[keyIndex]) + ':' + stableStringify(value[keys[keyIndex]]));
		}
		return '{' + keyValuePairs.join(',') + '}';
	}

	function sha256Hex(value){
		return Crypto.util.bytesToHex(Crypto.SHA256(Crypto.charenc.UTF8.stringToBytes(value), {asBytes: true}));
	}

	function escapeHtml(value){
		return String(value || '').replace(/[&<>'"]/g, function(character){
			return {'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[character];
		});
	}

	function getState(){
		return STORAGE.load();
	}

	function saveState(state){
		return STORAGE.save(state);
	}

	function sessionById(swapId){
		return getState().sessions[swapId] || null;
	}

	swapModule.createSwapAccount = function(passphrase){
		if(!passphrase){
			throw new Error('Swap account passphrase is required');
		}
		var master = coinjs.hd().master('rod-otc-swap|' + passphrase);
		return {
			xprv: master.privkey,
			xpub: master.pubkey
		};
	};

	swapModule.swapIdFromOrder = function(orderName, orderRevision, buyerIdentity){
		return sha256Hex([orderName || '', orderRevision || '', buyerIdentity || ''].join('|'));
	};

	swapModule.childIndexFromSwapId = function(swapId){
		var hashBytes = Crypto.SHA256(Crypto.util.hexToBytes(swapId), {asBytes: true});
		return ((hashBytes[0] << 24) | (hashBytes[1] << 16) | (hashBytes[2] << 8) | hashBytes[3]) & 0x7fffffff;
	};

	function hdNodeFromAccountKey(swapAccountKey){
		if(!swapAccountKey || typeof swapAccountKey !== 'string'){
			throw new Error('Swap account key is missing or invalid');
		}
		var node = coinjs.hd(swapAccountKey);
		if(!node || !node.keys || !node.keys.pubkey){
			throw new Error('Unable to parse swap account key (expected xprv/xpub)');
		}
		return node;
	}

	function accountXpub(swapAccountKey){
		var node = hdNodeFromAccountKey(swapAccountKey);
		if(node.type === 'public'){
			return swapAccountKey;
		}
		if(node.keys_extended && node.keys_extended.pubkey){
			return node.keys_extended.pubkey;
		}
		/* Rebuild xpub at same depth via make */
		var encoded = coinjs.hd().make({
			depth: node.depth,
			parent_fingerprint: node.parent_fingerprint,
			child_index: node.child_index,
			chain_code: node.chain_code,
			pubkey: node.keys.pubkey
		});
		if(!encoded || !encoded.pubkey){
			throw new Error('Unable to export swap account xpub');
		}
		return encoded.pubkey;
	}

	swapModule.deriveSwapKeys = function(swapAccountKey, childIndex){
		var account = hdNodeFromAccountKey(swapAccountKey);
		var derivedHd = account.derive(childIndex);
		if(!derivedHd || !derivedHd.keys || !derivedHd.keys.pubkey){
			throw new Error('HD child derivation failed for index ' + childIndex);
		}
		var ext = derivedHd.keys_extended || {};
		return {
			childIndex: childIndex,
			xpub: ext.pubkey || '',
			xprv: ext.privkey || '',
			publicKey: derivedHd.keys.pubkey,
			privateKeyWif: derivedHd.keys.wif || '',
			privateKeyHex: derivedHd.keys.privkey || ''
		};
	};

	swapModule.buildTerms = function(input){
		var childIndex = input.childIndex;
		var alicePublicKey = input.aliceChildPubKey;
		var bobPublicKey = input.bobChildPubKey;
		var canonicalTerms = {
			swapId: input.swapId,
			orderId: input.orderId,
			pair: 'ROD/LTC',
			rodAmount: input.rodAmount,
			ltcAmount: input.ltcAmount,
			sellerSwapXpub: input.sellerSwapXpub,
			buyerSwapXpub: input.buyerSwapXpub,
			childIndex: childIndex,
			releaseRodHeight: parseInt(input.releaseRodHeight, 10),
			aliceChildPubKey: alicePublicKey,
			bobChildPubKey: bobPublicKey,
			sellerLtcPayoutAddress: input.sellerLtcPayoutAddress,
			buyerRodPayoutAddress: input.buyerRodPayoutAddress
		};
		canonicalTerms.termsHash = sha256Hex(stableStringify(canonicalTerms));
		canonicalTerms.rodFunding = CHAINS.planFunding('ROD', [alicePublicKey, bobPublicKey], 2, canonicalTerms.rodAmount);
		canonicalTerms.ltcFunding = CHAINS.planFunding('LTC', [alicePublicKey, bobPublicKey], 2, canonicalTerms.ltcAmount);
		canonicalTerms.rodClaim = CHAINS.planClaim('ROD', canonicalTerms.rodFunding, canonicalTerms.buyerRodPayoutAddress, canonicalTerms.rodAmount, '0.00001000');
		canonicalTerms.ltcClaim = CHAINS.planClaim('LTC', canonicalTerms.ltcFunding, canonicalTerms.sellerLtcPayoutAddress, canonicalTerms.ltcAmount, '0.00001000');
		return canonicalTerms;
	};

	swapModule.advanceState = function(session, nextState, note){
		if(!session || !session.state){
			throw new Error('Swap session is missing state');
		}
		if(ALLOWED_TRANSITIONS[session.state].indexOf(nextState) === -1){
			throw new Error('Illegal OTC state transition from ' + session.state + ' to ' + nextState);
		}
		session.state = nextState;
		session.timeline = session.timeline || [];
		session.timeline.push({
			state: nextState,
			at: new Date().toISOString(),
			note: note || ''
		});
		var state = getState();
		state.sessions[session.swapId] = session;
		saveState(state);
		return session;
	};

	swapModule.safeAdvance = function(session, nextState, note){
		if(!session || !session.state){
			throw new Error('Swap session is missing state');
		}
		var stateOrder = ['OPEN', 'NEGOTIATING', 'TERMS_ACCEPTED', 'SIGNATURES_EXCHANGED', 'ALICE_ROD_FUNDED', 'BOB_LTC_FUNDED', 'READY', 'LTC_CLAIMED', 'SECRET_RECOVERED', 'ROD_CLAIMED', 'COMPLETE'];
		var currentIndex = stateOrder.indexOf(session.state);
		var nextIndex = stateOrder.indexOf(nextState);
		if(nextIndex === -1){
			throw new Error('Unknown OTC state: ' + nextState);
		}
		if(currentIndex >= nextIndex){
			return session;
		}
		while(currentIndex + 1 < nextIndex){
			swapModule.advanceState(session, stateOrder[currentIndex + 1], 'Auto-advanced toward ' + nextState);
			currentIndex = stateOrder.indexOf(session.state);
		}
		return swapModule.advanceState(session, nextState, note);
	};

	swapModule.validateFundingEvidence = function(evidence, expected){
		if(!evidence || !evidence.txid){
			throw new Error('Funding txid is missing');
		}
		if(expected && evidence.address !== expected.multisigAddress){
			throw new Error('Funding address mismatch');
		}
		if(expected && String(evidence.amount) !== String(expected.amount)){
			throw new Error('Funding amount mismatch');
		}
		return evidence;
	};

	swapModule.createOfferSession = function(input){
		if(!input || !input.swapId){
			throw new Error('Swap session input is incomplete');
		}
		if(!input.sellerSwapAccountKey){
			throw new Error('Seller swap account key is required');
		}
		if(!input.buyerSwapAccountKey){
			throw new Error('Buyer swap account key is required');
		}
		var childIndex = swapModule.childIndexFromSwapId(input.swapId);
		var sellerSwapKeys = swapModule.deriveSwapKeys(input.sellerSwapAccountKey, childIndex);
		var buyerSwapKeys = swapModule.deriveSwapKeys(input.buyerSwapAccountKey, childIndex);
		var terms = swapModule.buildTerms({
			swapId: input.swapId,
			orderId: input.orderId,
			rodAmount: input.rodAmount,
			ltcAmount: input.ltcAmount,
			sellerSwapXpub: accountXpub(input.sellerSwapAccountKey),
			buyerSwapXpub: accountXpub(input.buyerSwapAccountKey),
			childIndex: sellerSwapKeys.childIndex,
			releaseRodHeight: input.releaseRodHeight,
			aliceChildPubKey: sellerSwapKeys.publicKey,
			bobChildPubKey: buyerSwapKeys.publicKey,
			sellerLtcPayoutAddress: input.sellerLtcPayoutAddress,
			buyerRodPayoutAddress: input.buyerRodPayoutAddress
		});
		var session = {
			swapId: input.swapId,
			orderId: input.orderId,
			role: input.role,
			state: 'OPEN',
			terms: terms,
			childIndex: sellerSwapKeys.childIndex,
			sellerSwapXpub: terms.sellerSwapXpub,
			buyerSwapXpub: terms.buyerSwapXpub,
			localChildPrivateKey: input.role === 'alice' ? sellerSwapKeys.privateKeyHex : buyerSwapKeys.privateKeyHex,
			localChildPublicKey: input.role === 'alice' ? sellerSwapKeys.publicKey : buyerSwapKeys.publicKey,
			remoteChildPublicKey: input.role === 'alice' ? buyerSwapKeys.publicKey : sellerSwapKeys.publicKey,
			adaptorSecret: '',
			adaptorPoint: '',
			messages: [],
			timeline: [{ state: 'OPEN', at: new Date().toISOString(), note: 'Session created' }]
		};
		var state = getState();
		state.sessions[session.swapId] = session;
		saveState(state);
		return session;
	};

	swapModule.listSessions = function(){
		var state = getState();
		var sessions = [];
		for(var swapId in state.sessions){
			if(state.sessions.hasOwnProperty(swapId)){
				sessions.push(state.sessions[swapId]);
			}
		}
		return sessions;
	};

	swapModule.addMessage = function(swapId, eventObject){
		var state = getState();
		var session = state.sessions[swapId];
		if(!session){
			throw new Error('Unknown swap session: ' + swapId);
		}
		NOSTR.validateEnvelope(eventObject);
		session.messages = session.messages || [];
		session.messages.push(eventObject);
		state.sessions[swapId] = session;
		saveState(state);
		return session;
	};

	swapModule.createEnvelopeForSession = function(session, type, payload, pubkey, privateKeyHex){
		var previousMessage = session.messages && session.messages.length ? session.messages[session.messages.length - 1] : null;
		return NOSTR.createEnvelope({
			swapId: session.swapId,
			type: type,
			sequence: previousMessage ? (JSON.parse(previousMessage.content).sequence + 1) : 1,
			previousEventId: previousMessage ? previousMessage.id : '',
			payload: payload,
			pubkey: pubkey,
			privateKeyHex: privateKeyHex
		});
	};

	swapModule.getConfig = function(){
		return getState().config || { nameHelperUrl: '' };
	};

	swapModule.setNameHelperUrl = function(helperUrl){
		var state = getState();
		state.config = state.config || {};
		state.config.nameHelperUrl = $.trim(helperUrl || '');
		saveState(state);
		return state.config.nameHelperUrl;
	};

	swapModule.validateRodNameRecord = function(nameValue){
		var parsedValue = (typeof nameValue === 'string') ? JSON.parse(nameValue) : nameValue;
		if(!parsedValue || typeof parsedValue !== 'object' || coinjs.isArray(parsedValue)){
			throw new Error('ROD name value must be a JSON object');
		}
		var serializedValue = stableStringify(parsedValue);
		if(Crypto.charenc.UTF8.stringToBytes(serializedValue).length > 2048){
			throw new Error('ROD name value exceeds 2048-byte limit');
		}
		return {
			object: parsedValue,
			serialized: serializedValue
		};
	};

	swapModule.nameAdapter = {
		request: function(action, requestBody, callback){
			var helperUrl = swapModule.getConfig().nameHelperUrl;
			if(!helperUrl){
				callback({ success: false, unavailable: true, error: 'ROD name helper endpoint is not configured' });
				return;
			}
			$.ajax({
				url: helperUrl,
				method: 'POST',
				contentType: 'application/json',
				data: JSON.stringify({ action: action, payload: requestBody }),
				success: function(response){
					callback({ success: true, data: response });
				},
				error: function(xhr){
					callback({ success: false, error: xhr && xhr.responseText ? xhr.responseText : 'ROD name helper request failed' });
				}
			});
		},
		lookup: function(name, callback){
			this.request('lookup', { name: name }, callback);
		},
		register: function(name, value, callback){
			var validated = swapModule.validateRodNameRecord(value);
			this.request('register', { name: name, value: validated.object }, callback);
		},
		update: function(name, value, callback){
			var validated = swapModule.validateRodNameRecord(value);
			this.request('update', { name: name, value: validated.object }, callback);
		},
		remove: function(name, callback){
			this.request('delete', { name: name }, callback);
		}
	};

	swapModule.validationFixtures = function(){
		var aliceAccount = swapModule.createSwapAccount('alice fixture passphrase');
		var bobAccount = swapModule.createSwapAccount('bob fixture passphrase');
		var swapId = swapModule.swapIdFromOrder('alice.rod/order-1', '1', 'bob.rod');
		var childIndex = swapModule.childIndexFromSwapId(swapId);
		var aliceKeys = swapModule.deriveSwapKeys(aliceAccount.xprv, childIndex);
		var bobKeys = swapModule.deriveSwapKeys(bobAccount.xprv, childIndex);
		var terms = swapModule.buildTerms({
			swapId: swapId,
			orderId: 'alice.rod/order-1',
			rodAmount: '1000.00000000',
			ltcAmount: '5.00000000',
			sellerSwapXpub: aliceAccount.xpub,
			buyerSwapXpub: bobAccount.xpub,
			childIndex: childIndex,
			releaseRodHeight: 1500000,
			aliceChildPubKey: aliceKeys.publicKey,
			bobChildPubKey: bobKeys.publicKey,
			sellerLtcPayoutAddress: CHAINS.publicKeyToAddress('LTC', aliceKeys.publicKey, 'legacy'),
			buyerRodPayoutAddress: CHAINS.publicKeyToAddress('ROD', bobKeys.publicKey, 'legacy')
		});
		return {
			aliceAccount: aliceAccount,
			bobAccount: bobAccount,
			swapId: swapId,
			childIndex: childIndex,
			aliceKeys: aliceKeys,
			bobKeys: bobKeys,
			terms: terms
		};
	};

	swapModule.testFixtures = function(){
		var fixtures = swapModule.validationFixtures();
		var recomputedTerms = swapModule.buildTerms({
			swapId: fixtures.swapId,
			orderId: 'alice.rod/order-1',
			rodAmount: '1000.00000000',
			ltcAmount: '5.00000000',
			sellerSwapXpub: fixtures.aliceAccount.xpub,
			buyerSwapXpub: fixtures.bobAccount.xpub,
			childIndex: fixtures.childIndex,
			releaseRodHeight: 1500000,
			aliceChildPubKey: fixtures.aliceKeys.publicKey,
			bobChildPubKey: fixtures.bobKeys.publicKey,
			sellerLtcPayoutAddress: fixtures.terms.sellerLtcPayoutAddress,
			buyerRodPayoutAddress: fixtures.terms.buyerRodPayoutAddress
		});
		var nameValidation = false;
		try {
			swapModule.validateRodNameRecord({ offer: true, pair: 'ROD/LTC' });
			nameValidation = true;
		} catch(error){
			nameValidation = false;
		}
		return {
			name: 'Swap account and terms fixtures',
			passed: fixtures.terms.termsHash === recomputedTerms.termsHash && fixtures.aliceKeys.publicKey !== fixtures.bobKeys.publicKey && nameValidation,
			fixtures: fixtures
		};
	};

	swapModule.testNameAdapterUnconfigured = function(){
		var previousUrl = swapModule.getConfig().nameHelperUrl;
		swapModule.setNameHelperUrl('');
		var result = null;
		swapModule.nameAdapter.lookup('sf/alice', function(response){
			result = response;
		});
		swapModule.setNameHelperUrl(previousUrl);
		var jsonValidationPassed = false;
		try {
			swapModule.validateRodNameRecord({ profile: { handle: 'alice' } });
			jsonValidationPassed = true;
		} catch(error){
			jsonValidationPassed = false;
		}
		return {
			name: 'ROD name helper adapter',
			passed: result && result.unavailable === true && jsonValidationPassed,
			response: result
		};
	};

	swapModule.testAdaptorSettlementFlow = function(){
		var fixtures = swapModule.validationFixtures();
		var engine = root.engine;
		if(!engine || !engine.buildClaimTxFromFunding || !engine.makeAdaptorSig || !engine.recoverSecret){
			return {
				name: 'Adaptor-gated OTC settlement flow',
				passed: false,
				error: 'Settlement engine is unavailable for adaptor validation'
			};
		}
		var adaptorSecret = coinjs.adaptor.generateSecret();
		var adaptorPoint = coinjs.adaptor.publicKey(adaptorSecret);
		var aliceSession = {
			role: 'alice',
			swapId: fixtures.swapId,
			terms: fixtures.terms,
			localChildPrivateKey: fixtures.aliceKeys.privateKeyHex,
			adaptorSecret: adaptorSecret,
			adaptorPoint: adaptorPoint,
			execution: {
				rodFunding: { txid: '11'.repeat(32), vout: 0, amount: fixtures.terms.rodAmount, value: CHAINS.decimalToSats(fixtures.terms.rodAmount) },
				ltcFunding: { txid: '22'.repeat(32), vout: 1, amount: fixtures.terms.ltcAmount, value: CHAINS.decimalToSats(fixtures.terms.ltcAmount) }
			}
		};
		var bobSession = {
			role: 'bob',
			swapId: fixtures.swapId,
			terms: fixtures.terms,
			localChildPrivateKey: fixtures.bobKeys.privateKeyHex,
			adaptorPoint: adaptorPoint,
			execution: {
				rodFunding: { txid: '11'.repeat(32), vout: 0, amount: fixtures.terms.rodAmount, value: CHAINS.decimalToSats(fixtures.terms.rodAmount) },
				ltcFunding: { txid: '22'.repeat(32), vout: 1, amount: fixtures.terms.ltcAmount, value: CHAINS.decimalToSats(fixtures.terms.ltcAmount) }
			}
		};
		var ltcClaim = engine.buildClaimTxFromFunding('LTC', aliceSession.execution.ltcFunding, fixtures.terms.ltcFunding.redeemScript, fixtures.terms.sellerLtcPayoutAddress, '0.00001000');
		var rodClaim = engine.buildClaimTxFromFunding('ROD', bobSession.execution.rodFunding, fixtures.terms.rodFunding.redeemScript, fixtures.terms.buyerRodPayoutAddress, '0.00051900');
		var ltcAdaptor = engine.makeAdaptorSig(bobSession, ltcClaim);
		var rodAdaptor = engine.makeAdaptorSig(aliceSession, rodClaim);
		var ltcVerified = coinjs.adaptor.verify({
			messageHash: engine.sighash(ltcClaim),
			signingPublicKey: fixtures.bobKeys.publicKey,
			adaptorPublicKey: adaptorPoint,
			adaptorSignature: ltcAdaptor.bytes
		});
		var rodVerified = coinjs.adaptor.verify({
			messageHash: engine.sighash(rodClaim),
			signingPublicKey: fixtures.aliceKeys.publicKey,
			adaptorPublicKey: adaptorPoint,
			adaptorSignature: rodAdaptor.bytes
		});
		var completedLtcSignature = engine.completeSig(ltcAdaptor.bytes, adaptorSecret);
		var recoveredSecret = engine.recoverSecret(ltcAdaptor.bytes, completedLtcSignature, adaptorPoint);
		var completedRodSignature = engine.completeSig(rodAdaptor.bytes, recoveredSecret);
		return {
			name: 'Adaptor-gated OTC settlement flow',
			passed: ltcVerified && rodVerified && recoveredSecret === adaptorSecret && !!completedLtcSignature && !!completedRodSignature,
			ltcVerified: ltcVerified,
			rodVerified: rodVerified,
			recoveredSecretMatches: recoveredSecret === adaptorSecret,
			completedLtcSignature: completedLtcSignature,
			completedRodSignature: completedRodSignature
		};
	};

	swapModule.ui = {
		init: function(){
			if(!window.jQuery || !$('#otc').length){
				return;
			}
			var config = swapModule.getConfig();
			$('#otcNameHelperUrl').val(config.nameHelperUrl || '');
			this.renderSessions();
			this.bindEvents();
		},

		bindEvents: function(){
			var self = this;
			$('#otcSaveConfigBtn').off('click').on('click', function(){
				swapModule.setNameHelperUrl($('#otcNameHelperUrl').val());
				self.showStatus('Saved OTC helper configuration locally. Deployment CSP only permits same-origin or localhost/127.0.0.1 helper origins on port 11999.', 'success');
			});
			$('#otcGenerateSwapAccountsBtn').off('click').on('click', function(){
				try {
					var sellerAccount = swapModule.createSwapAccount($('#otcSellerSwapSeed').val());
					var buyerAccount = swapModule.createSwapAccount($('#otcBuyerSwapSeed').val());
					$('#otcSellerSwapXprv').val(sellerAccount.xprv);
					$('#otcSellerSwapXpub').val(sellerAccount.xpub);
					$('#otcBuyerSwapXprv').val(buyerAccount.xprv);
					$('#otcBuyerSwapXpub').val(buyerAccount.xpub);
					self.showStatus('Derived dedicated OTC swap accounts. Keep xprv values private and never send them to peers.', 'success');
				} catch(error){
					self.showStatus(error.message, 'danger');
				}
			});
			$('#otcCreateOfferBtn').off('click').on('click', function(){
				try {
					var orderId = $.trim($('#otcOrderId').val());
					var buyerIdentity = $.trim($('#otcBuyerIdentity').val());
					var swapId = swapModule.swapIdFromOrder(orderId, $('#otcOrderRevision').val(), buyerIdentity);
					var sellerSwapAccountKey = $.trim($('#otcSellerSwapXprv').val()) || $.trim($('#otcSellerSwapXpub').val());
					var buyerSwapAccountKey = $.trim($('#otcBuyerSwapXprv').val()) || $.trim($('#otcBuyerSwapXpub').val());
					var session = swapModule.createOfferSession({
						role: 'alice',
						swapId: swapId,
						orderId: orderId,
						rodAmount: $('#otcRodAmount').val(),
						ltcAmount: $('#otcLtcAmount').val(),
						releaseRodHeight: $('#otcReleaseHeight').val(),
						sellerSwapAccountKey: sellerSwapAccountKey,
						buyerSwapAccountKey: buyerSwapAccountKey
					});
					var offerPayload = {
						version: 1,
						type: 'otc-order',
						seller: $('#otcSellerName').val(),
						pair: 'ROD/LTC',
						give: $('#otcRodAmount').val(),
						want: $('#otcLtcAmount').val(),
						sellerSwapXpub: session.sellerSwapXpub,
						buyerSwapXpub: session.buyerSwapXpub,
						releaseRodHeight: parseInt($('#otcReleaseHeight').val(), 10),
						termsHash: session.terms.termsHash
					};
					$('#otcOfferJson').val(JSON.stringify(offerPayload, null, 2));
					$('#otcCurrentSwapId').val(session.swapId);
					$('#otcTermsJson').val(JSON.stringify(session.terms, null, 2));
					$('#otcFundingEvidence').val(JSON.stringify({ rodFunding: session.terms.rodFunding, ltcFunding: session.terms.ltcFunding, rodClaim: session.terms.rodClaim, ltcClaim: session.terms.ltcClaim }, null, 2));
					self.renderSessions();
					self.showStatus('Created OTC offer session with deterministic swap terms and planning evidence. The derived child private key stays only in this live page state and is stripped from local backups.', 'success');
				} catch(error){
					self.showStatus(error.message, 'danger');
				}
			});
			$('#otcExportMessageBtn').off('click').on('click', function(){
				try {
					var session = sessionById($('#otcCurrentSwapId').val());
					if(!session){
						throw new Error('Create or select an OTC session first');
					}
					var event = swapModule.createEnvelopeForSession(session, $('#otcMessageType').val(), JSON.parse($('#otcMessagePayload').val() || '{}'));
					swapModule.addMessage(session.swapId, event);
					$('#otcMessageEnvelope').val(NOSTR.exportEnvelope(event));
					self.renderSessions();
					self.showStatus('Exported manual OTC Nostr envelope. Review before sharing; never include private keys or adaptor secrets.', 'success');
				} catch(error){
					self.showStatus(error.message, 'danger');
				}
			});
			$('#otcImportMessageBtn').off('click').on('click', function(){
				try {
					var event = NOSTR.importEnvelope($('#otcMessageEnvelope').val());
					swapModule.addMessage(JSON.parse(event.content).swapId, event);
					self.renderSessions();
					self.showStatus('Imported OTC Nostr envelope after validation.', 'success');
				} catch(error){
					self.showStatus(error.message, 'danger');
				}
			});
			$('#otcValidateAdaptorBtn').off('click').on('click', function(){
				var result = ADAPTOR.runValidation();
				$('#otcValidationOutput').val(JSON.stringify(result, null, 2));
				self.showStatus(result.passed ? 'Adaptor validation passed.' : 'Adaptor validation failed.', result.passed ? 'success' : 'danger');
			});
			$('#otcRunValidationBtn').off('click').on('click', function(){
				var result = root.validation.runAll();
				$('#otcValidationOutput').val(JSON.stringify(result, null, 2));
				self.showStatus(result.passed ? 'OTC validation suite passed.' : 'OTC validation suite reported failures.', result.passed ? 'success' : 'danger');
			});
			$('#otcBackupBtn').off('click').on('click', function(){
				$('#otcBackupJson').val(STORAGE.exportState());
				self.showStatus('Exported OTC storage backup without private signing material.', 'success');
			});
			$('#otcRestoreBtn').off('click').on('click', function(){
				try {
					STORAGE.importState($('#otcBackupJson').val());
					self.renderSessions();
					self.showStatus('Restored OTC backup from validated local JSON.', 'success');
				} catch(error){
					self.showStatus(error.message, 'danger');
				}
			});
			$('#otcNameLookupBtn').off('click').on('click', function(){
				swapModule.nameAdapter.lookup($('#otcRodName').val(), function(response){
					$('#otcNameAdapterOutput').val(JSON.stringify(response, null, 2));
					self.showStatus(response.success ? 'Name lookup request completed.' : (response.unavailable ? 'ROD name helper is not configured.' : 'Name lookup request failed.'), response.success ? 'success' : 'warning');
				});
			});
			$('#otcNameRegisterBtn').off('click').on('click', function(){
				try {
					var record = JSON.parse($('#otcRodNameValue').val());
					swapModule.nameAdapter.register($('#otcRodName').val(), record, function(response){
						$('#otcNameAdapterOutput').val(JSON.stringify(response, null, 2));
						self.showStatus(response.success ? 'Name register request completed.' : (response.unavailable ? 'ROD name helper is not configured.' : 'Name register request failed.'), response.success ? 'success' : 'warning');
					});
				} catch(error){
					self.showStatus(error.message, 'danger');
				}
			});
			$('#otcAdvanceStateBtn').off('click').on('click', function(){
				try {
					var session = sessionById($('#otcCurrentSwapId').val());
					if(!session){
						throw new Error('Select an OTC session first');
					}
					swapModule.advanceState(session, $('#otcNextState').val(), 'Manual UI smoke advance');
					self.renderSessions();
					self.showStatus('Advanced OTC state to ' + $('#otcNextState').val() + '.', 'success');
				} catch(error){
					self.showStatus(error.message, 'danger');
				}
			});
		},

		showStatus: function(message, type){
			var statusBox = $('#otcStatus');
			statusBox.removeClass('hidden alert-success alert-danger alert-warning alert-info').addClass('alert-' + (type || 'info')).text(message);
		},

		renderSessions: function(){
			var sessions = swapModule.listSessions();
			var rows = [];
			for(var index = 0; index < sessions.length; index++){
				rows.push('<tr><td><button type="button" class="btn btn-xs btn-default otcSelectSessionBtn" data-swap-id="' + escapeHtml(sessions[index].swapId) + '">Use</button></td><td>' + escapeHtml(sessions[index].swapId) + '</td><td>' + escapeHtml(sessions[index].role) + '</td><td>' + escapeHtml(sessions[index].state) + '</td><td>' + escapeHtml(sessions[index].terms.termsHash) + '</td></tr>');
			}
			$('#otcSessionTable tbody').html(rows.join('') || '<tr><td colspan="5" class="text-muted">No OTC sessions saved yet.</td></tr>');
			$('.otcSelectSessionBtn').off('click').on('click', function(){
				var session = sessionById($(this).data('swap-id'));
				if(!session){
					return;
				}
				$('#otcCurrentSwapId').val(session.swapId);
				$('#otcTermsJson').val(JSON.stringify(session.terms, null, 2));
				$('#otcFundingEvidence').val(JSON.stringify({ rodFunding: session.terms.rodFunding, ltcFunding: session.terms.ltcFunding, rodClaim: session.terms.rodClaim, ltcClaim: session.terms.ltcClaim, timeline: session.timeline || [] }, null, 2));
				$('#otcMessageEnvelope').val(session.messages && session.messages.length ? NOSTR.exportEnvelope(session.messages[session.messages.length - 1]) : '');
			});
		}
	};

	root.validation = root.validation || {};
	root.validation.runAll = function(){
		var results = [
			ADAPTOR.runValidation(),
			CHAINS.testAgainstRodGlobals(),
			STORAGE.testPersistence(),
			NOSTR.testValidation(),
			swapModule.testNameAdapterUnconfigured(),
			swapModule.testFixtures(),
			swapModule.testAdaptorSettlementFlow()
		];
		var passed = true;
		for(var index = 0; index < results.length; index++){
			if(!results[index].passed){
				passed = false;
			}
		}
		return {
			passed: passed,
			results: results,
			completedAt: new Date().toISOString()
		};
	};
})();
