/*
	otc-engine.js — Phase 2 swap engine.
	Namespace: window.rodOtc.engine
*/
(function () {
	'use strict';
	var root = window.rodOtc = window.rodOtc || {};
	var engine = root.engine = {};
	var SWAP = root.swap;
	var STORAGE = root.storage;
	var CHAINS = root.chains;
	var NOSTR = root.nostr;

	/* ============ Config ============ */
	var CFG_KEY = 'rodOtcEngineConfig';
	var defaults = {
		rodApiUrl: 'https://api.spacexpanse.org:1234',
		ltcApiUrl: 'https://litecoinspace.org/api',
		rpcUrl: '', rpcPort: '18080', rpcUser: '', rpcPass: '', rpcWallet: '',
		relays: ['wss://relay.damus.io','wss://nos.lol','wss://relay.nostr.band'],
		releaseBlocks: 20
	};
	engine.defaults = defaults;
	/* Shallow merge + explicit array replace.
	   jQuery deep extend merges arrays by index, so saving 2 relays left the 3rd default stuck. */
	engine.loadConfig = function () {
		var cfg = $.extend({}, defaults);
		cfg.relays = defaults.relays.slice();
		try {
			var raw = localStorage.getItem(CFG_KEY);
			if (!raw) return cfg;
			var saved = JSON.parse(raw);
			if (!saved || typeof saved !== 'object') return cfg;
			$.extend(cfg, saved);
			if (Object.prototype.hasOwnProperty.call(saved, 'relays')) {
				cfg.relays = $.isArray(saved.relays) ? saved.relays.slice() : defaults.relays.slice();
			} else {
				cfg.relays = defaults.relays.slice();
			}
			return cfg;
		} catch (e) {
			cfg = $.extend({}, defaults);
			cfg.relays = defaults.relays.slice();
			return cfg;
		}
	};
	engine.saveConfig = function (c) {
		var toSave = $.extend({}, c || {});
		if ($.isArray(toSave.relays)) {
			toSave.relays = toSave.relays.slice();
		}
		localStorage.setItem(CFG_KEY, JSON.stringify(toSave));
	};

	/* ============ Wallet bridge ============ */
	engine.getWalletIdentity = function () {
		var wif = $('#walletKeys .privkey').val() || '';
		var pub = $('#walletKeys .pubkey').val() || '';
		var addr = $('#walletAddress').text() || '';
		if (!wif || !pub) return null;
		return { wif: wif, pubkey: pub, address: addr };
	};
	engine.walletPassword = function () {
		var w = engine.getWalletIdentity();
		return w ? w.wif : '';
	};
	/* Returns master HD account {privkey:xprv, pubkey:xpub} from coinjs.hd().make() */
	engine.deriveSwapAccount = function (wif) {
		if (!wif) throw new Error('Wallet WIF is required to derive swap account');
		var decoded = coinjs.wif2privkey(wif);
		if (!decoded || !decoded.privkey) throw new Error('Invalid wallet WIF');
		var master = coinjs.hd().master('rod-otc-swap|' + decoded.privkey);
		if (!master || !master.privkey || !master.pubkey) {
			throw new Error('HD master derivation failed');
		}
		return master;
	};

	/* ============ API access ============ */
	engine.rodGet = function (path) {
		return $.getJSON(engine.loadConfig().rodApiUrl + path);
	};
	engine.ltcGet = function (path) {
		return $.getJSON(engine.loadConfig().ltcApiUrl + path);
	};
	engine.getRodHeight = function () {
		return engine.rodGet('/info').then(function (r) {
			var d = r.result || r;
			return d.blocks || d.height || (d.info && d.info.blocks) || 0;
		});
	};
	/**
	 * Resolve stored RPC settings to a display endpoint (no network I/O).
	 * This static wallet cannot call raw ROD Core from the browser (no CORS);
	 * settings are retained for optional same-origin / helper workflows only.
	 */
	engine.buildRpcEndpoint = function (cfg) {
		var c = cfg || engine.loadConfig();
		var raw = $.trim(c.rpcUrl || '');
		if (!raw) return null;

		var user = $.trim(c.rpcUser || '');
		var pass = c.rpcPass || '';
		var port = $.trim(c.rpcPort || '') || '11999';
		var wallet = $.trim(c.rpcWallet || '');
		var endpoint = raw;
		var pathFromUrl = '';

		// Full URL: scheme://[user:pass@]host[:port][/path]
		if (/^https?:\/\//i.test(raw)) {
			var m = raw.match(/^(https?):\/\/(?:([^:@\/]+)(?::([^@\/]*))?@)?([^:\/]+)(?::(\d+))?(\/.*)?$/i);
			if (!m) return null;
			var scheme = m[1];
			if (m[2] && !user) {
				user = decodeURIComponent(m[2]);
				pass = m[3] != null ? decodeURIComponent(m[3]) : pass;
			}
			var host = m[4];
			var urlPort = m[5] || port;
			pathFromUrl = m[6] || '';
			endpoint = scheme + '://' + host + ':' + urlPort;
		} else {
			raw = raw.replace(/\/+$/, '');
			if (raw.indexOf(':') !== -1 && raw.split(':').length === 2 && /^\d+$/.test(raw.split(':')[1])) {
				endpoint = 'http://' + raw.replace(/^\/\//, '');
			} else {
				endpoint = 'http://' + raw.replace(/^\/\//, '') + ':' + port;
			}
		}

		// Multiwallet path: bare /NAME → /wallet/NAME
		if (pathFromUrl && pathFromUrl !== '/') {
			var cleanPath = pathFromUrl.replace(/\/+$/, '');
			if (/^\/[^\/]+$/.test(cleanPath) && cleanPath.indexOf('/wallet') !== 0) {
				cleanPath = '/wallet' + cleanPath;
			}
			endpoint += cleanPath;
		} else if (wallet) {
			if (wallet.indexOf('/wallet/') === 0) endpoint += wallet;
			else if (wallet.indexOf('wallet/') === 0) endpoint += '/' + wallet;
			else if (wallet.indexOf('/') === 0) endpoint += '/wallet' + wallet;
			else endpoint += '/wallet/' + encodeURIComponent(wallet);
		}

		return {
			url: endpoint,
			user: user,
			pass: pass,
			authHeader: user ? ('Basic ' + btoa(user + ':' + pass)) : ''
		};
	};

	/* JSON-RPC call (use tools/rod-rpc-cors-proxy.exe in front of raw Core). */
	engine.rpc = function (method, params) {
		var ep = engine.buildRpcEndpoint();
		if (!ep) return $.Deferred().reject('RPC not configured').promise();
		var headers = { 'Content-Type': 'application/json' };
		if (ep.authHeader) headers.Authorization = ep.authHeader;
		return $.ajax({
			url: ep.url,
			method: 'POST',
			contentType: 'application/json',
			headers: headers,
			data: JSON.stringify({ jsonrpc: '1.0', id: 'otc', method: method, params: params || [] }),
			timeout: 8000
		}).then(function (r) {
			if (r && r.error) {
				return $.Deferred().reject(r.error.message || JSON.stringify(r.error)).promise();
			}
			return r ? r.result : null;
		});
	};

	/* Live probe when a CORS-capable endpoint (e.g. tools proxy) is configured. */
	engine.checkRpcStatus = function () {
		var c = engine.loadConfig();
		var d = $.Deferred();
		if (!$.trim(c.rpcUrl || '')) {
			d.resolve({ configured: false, online: false, message: 'Not configured' });
			return d.promise();
		}
		var ep = engine.buildRpcEndpoint(c);
		if (!ep) {
			d.resolve({ configured: false, online: false, message: 'Invalid URL' });
			return d.promise();
		}
		engine.rpc('getblockcount', []).then(function (height) {
			d.resolve({ configured: true, online: true, message: 'Connected', height: height, url: ep.url });
		}, function (err, textStatus) {
			var msg = 'Unreachable';
			if (typeof err === 'string') msg = err;
			else if (err && err.responseJSON && err.responseJSON.error) {
				msg = err.responseJSON.error.message || JSON.stringify(err.responseJSON.error);
			} else if (err && err.status === 401) msg = 'Auth failed (401)';
			else if (err && err.status > 0) msg = 'HTTP ' + err.status;
			else if (textStatus === 'timeout') msg = 'Timeout';
			else msg = 'Unreachable (start tools/rod-rpc-cors-proxy.exe?)';
			d.resolve({ configured: true, online: false, message: msg, url: ep.url });
		});
		return d.promise();
	};

	/* Extract order object from name_show result or raw value. */
	engine.extractNameValue = function (r) {
		if (r == null) return null;
		if (typeof r === 'string') {
			try { return JSON.parse(r); } catch (e) { return r; }
		}
		/* Full name_show record: prefer .value */
		if (r && typeof r === 'object' && r.value != null) {
			if (typeof r.value === 'string') {
				try { return JSON.parse(r.value); } catch (e2) { return { _rawValue: r.value }; }
			}
			if (typeof r.value === 'object') return r.value;
		}
		return r;
	};

	/* Name lookup: Core via proxy when RPC is configured, else name helper adapter. */
	engine.nameLookup = function (name) {
		var c = engine.loadConfig();
		if ($.trim(c.rpcUrl || '')) {
			return engine.rpc('name_show', [name]).then(function (r) {
				return engine.extractNameValue(r);
			});
		}
		var d = $.Deferred();
		SWAP.nameAdapter.lookup(name, function (resp) {
			if (resp.success && resp.data) {
				try {
					d.resolve(engine.extractNameValue(resp.data));
				} catch (e) { d.reject(e); }
			} else {
				d.reject(resp.error || (resp.unavailable ? 'Name helper not configured' : 'lookup failed'));
			}
		});
		return d.promise();
	};

	/**
	 * Publish a value to the ROD name DB (name_update if exists, else name_register).
	 * Requires ROD Core RPC (via tools/rod-rpc-cors-proxy.exe).
	 * Resolves { name, value, txid, action: 'update'|'register' }.
	 */
	engine.namePublish = function (name, valueObject) {
		var d = $.Deferred();
		var nameKey = $.trim(name || '');
		if (!nameKey) {
			d.reject('ROD name is required');
			return d.promise();
		}
		var c = engine.loadConfig();
		if (!$.trim(c.rpcUrl || '')) {
			d.reject('ROD Core RPC is not configured — set it in OTC Settings and run the CORS proxy');
			return d.promise();
		}
		var valueStr;
		try {
			if (typeof valueObject === 'string') {
				valueStr = valueObject;
			} else {
				/* Compact JSON for name value size limits */
				valueStr = JSON.stringify(valueObject);
			}
		} catch (e) {
			d.reject('Invalid order value');
			return d.promise();
		}
		if (valueStr.length > 1023) {
			d.reject('Order JSON is ' + valueStr.length + ' bytes (limit ~1023 for name value)');
			return d.promise();
		}

		function doUpdate() {
			return engine.rpc('name_update', [nameKey, valueStr]).then(function (txid) {
				return { name: nameKey, value: valueStr, txid: txid, action: 'update' };
			});
		}
		function doRegister() {
			return engine.rpc('name_register', [nameKey, valueStr]).then(function (txid) {
				return { name: nameKey, value: valueStr, txid: txid, action: 'register' };
			});
		}

		/* Prefer update when name already exists; otherwise register */
		engine.rpc('name_show', [nameKey]).then(function () {
			doUpdate().then(function (r) { d.resolve(r); }, function (err) { d.reject(err); });
		}, function () {
			doRegister().then(function (r) { d.resolve(r); }, function (err) {
				/* Race: name appeared between show and register — try update once */
				doUpdate().then(function (r) { d.resolve(r); }, function (err2) {
					d.reject(err2 || err || 'name_register/name_update failed');
				});
			});
		});
		return d.promise();
	};

	/* Validate/normalize an on-chain OTC order value. Returns {ok, offer?, reason?} */
	engine.normalizeOffer = function (name, value) {
		if (value == null) {
			return { ok: false, reason: 'empty name value' };
		}
		if (typeof value === 'string') {
			return { ok: false, reason: 'name value is not JSON (got a string)' };
		}
		if (value._rawValue) {
			return { ok: false, reason: 'name value is not valid JSON' };
		}
		var typeOk = (value.type === 'otc-order' || value.t === 'otc.offer' || value.type === 'otc.offer');
		if (!typeOk) {
			return { ok: false, reason: 'not an otc-order (type=' + (value.type || value.t || 'missing') + ')' };
		}
		var pair = value.pair || 'ROD/LTC';
		if (pair !== 'ROD/LTC') {
			return { ok: false, reason: 'unsupported pair ' + pair };
		}
		var give = value.give != null ? value.give : value.rodAmount;
		var want = value.want != null ? value.want : value.ltcAmount;
		if (!(parseFloat(give) > 0) || !(parseFloat(want) > 0)) {
			return {
				ok: false,
				reason: 'incomplete order — need give/want (or rodAmount/ltcAmount). On-chain value only has: ' +
					Object.keys(value).join(', ')
			};
		}
		var offer = $.extend({}, value);
		offer.pair = pair;
		offer.type = value.type || 'otc-order';
		offer.give = give;
		offer.want = want;
		offer._name = name;
		/* side: explicit, else sell/ask by default; buy → bid */
		if (!offer.side) {
			if (offer.buyerSwapXpub && !offer.sellerSwapXpub) offer.side = 'buy';
			else offer.side = 'sell';
		}
		return { ok: true, offer: offer };
	};

	/* ============ Nostr relay pool ============ */
	engine.DEFAULT_RELAYS = defaults.relays;
	function Pool(urls) {
		this.urls = urls || defaults.relays.slice();
		this.ws = {};
		this.h = {};
		this.outbox = [];
		this.n = 0;
		this.onStatus = null;
		this.onNotice = null;
		this.closed = false;
	}
	Pool.prototype.connect = function () { var s = this; this.urls.forEach(function (u) { s._open(u); }); };
	Pool.prototype._queue = function (eventObject) {
		if (!eventObject || !eventObject.id) return;
		for (var i = 0; i < this.outbox.length; i++) {
			if (this.outbox[i].id === eventObject.id) return;
		}
		this.outbox.push(eventObject);
		if (this.outbox.length > 100) this.outbox = this.outbox.slice(-100);
	};
	Pool.prototype._flush = function (u) {
		var w = this.ws[u];
		if (!w || w.readyState !== 1 || !this.outbox.length) return 0;
		var sent = 0;
		for (var i = 0; i < this.outbox.length; i++) {
			try { w.send(JSON.stringify(['EVENT', this.outbox[i]])); sent++; } catch (e) {}
		}
		return sent;
	};
	Pool.prototype._open = function (u) {
		var s = this;
		if (s.closed) return;
		if (s.ws[u] && s.ws[u].readyState <= 1) return;
		try {
			var w = new WebSocket(u);
			w.onopen = function () {
				if (s.closed) { try { w.close(); } catch (e0) {} return; }
				if (s.onStatus) s.onStatus('+', u);
				for (var id in s.h) if (s.h[id].f) w.send(JSON.stringify(['REQ', id, s.h[id].f]));
				var flushed = s._flush(u);
				if (flushed && s.onNotice) s.onNotice(['LOCAL_FLUSH', flushed], u);
			};
			w.onmessage = function (m) {
				try {
					var d = JSON.parse(m.data);
					if (d[0] === 'EVENT' && s.h[d[1]]) s.h[d[1]].cb(d[2], u);
					else if ((d[0] === 'OK' || d[0] === 'NOTICE' || d[0] === 'AUTH') && s.onNotice) s.onNotice(d, u);
				} catch (e) {}
			};
			w.onclose = function () {
				delete s.ws[u];
				if (s.onStatus) s.onStatus('-', u);
				/* Reconnect only while pool is still active */
				if (!s.closed) setTimeout(function () { s._open(u); }, 8000);
			};
			w.onerror = function () {};
			s.ws[u] = w;
		} catch (e) {}
	};
	Pool.prototype.close = function () {
		this.closed = true;
		for (var u in this.ws) {
			try {
				this.ws[u].onclose = null;
				this.ws[u].onmessage = null;
				this.ws[u].onerror = null;
				this.ws[u].close();
			} catch (e) {}
		}
		this.ws = {};
		this.h = {};
	};
	Pool.prototype.pub = function (ev) {
		this._queue(ev);
		var f = JSON.stringify(['EVENT', ev]), n = 0;
		for (var u in this.ws) if (this.ws[u].readyState === 1) { this.ws[u].send(f); n++; }
		return n;
	};
	Pool.prototype.sub = function (filt, cb) {
		var id = 'o' + (++this.n) + '-' + Date.now(); this.h[id] = { cb: cb, f: filt };
		var fr = JSON.stringify(['REQ', id, filt]); for (var u in this.ws) if (this.ws[u].readyState === 1) this.ws[u].send(fr);
		return id;
	};
	Pool.prototype.unsub = function (id) { delete this.h[id]; var f = JSON.stringify(['CLOSE', id]); for (var u in this.ws) if (this.ws[u].readyState === 1) this.ws[u].send(f); };
	Pool.prototype.count = function () { var c = 0; for (var u in this.ws) if (this.ws[u].readyState === 1) c++; return c; };
	Pool.prototype.total = function () { return (this.urls || []).length; };

	engine.pool = null;
	engine._wantListening = false;
	engine._listenHandler = null;
	engine.onRelayEventDebug = null;
	engine.onRelaySubscription = null;
	function debugRelay(message) {
		if (engine.onRelayEventDebug) engine.onRelayEventDebug(message);
	}
	function otcKinds() {
		var primary = (NOSTR && NOSTR.OTC_EVENT_KIND) || 7340;
		var legacy = (NOSTR && NOSTR.LEGACY_OTC_EVENT_KIND) || 33440;
		return primary === legacy ? [primary] : [primary, legacy];
	}

	engine.stopRelays = function () {
		if (engine.pool) {
			engine.pool.close();
			engine.pool = null;
		}
	};

	engine.startRelays = function (urls) {
		if (engine.pool && !engine.pool.closed) return engine.pool;
		var list = urls || engine.loadConfig().relays || engine.DEFAULT_RELAYS;
		if (!list || !list.length) list = engine.DEFAULT_RELAYS.slice();
		engine.pool = new Pool(list);
		engine.pool.connect();
		return engine.pool;
	};

	/* Close existing sockets and connect to a new relay list (used after Settings save). */
	engine.restartRelays = function (urls) {
		var prevStatus = engine.pool ? engine.pool.onStatus : null;
		engine.stopRelays();
		var pool = engine.startRelays(urls);
		if (prevStatus) pool.onStatus = prevStatus;
		if (engine._wantListening) {
			engine.startListening(true);
		}
		return pool;
	};

	/* ============ Nostr auto-negotiation ============ */
	var seen = {};
	engine.onSwapMessage = null;
	engine.publishSwapMessage = function (sess, type, payload) {
		var nostrPrivateKey = sess.localNostrPrivateKey || '';
		if (!nostrPrivateKey) {
			var walletIdentity = engine.getWalletIdentity();
			if (walletIdentity && walletIdentity.wif && NOSTR.identityFromWif) {
				nostrPrivateKey = NOSTR.identityFromWif(walletIdentity.wif).privateKeyHex;
			}
		}
		var ev = SWAP.createEnvelopeForSession(sess, type, payload, sess.localNostrPubkey, nostrPrivateKey);
		try { SWAP.addMessage(sess.swapId, ev); } catch (addError) { debugRelay('local message store skipped for ' + type + ': ' + (addError.message || addError)); }
		sess.messages = sess.messages || [];
		sess.messages.push(ev);
		try { engine.saveLive(sess); } catch (saveError) { debugRelay('live message store skipped for ' + type + ': ' + (saveError.message || saveError)); }
		var relayCount = engine.pool ? engine.pool.pub(ev) : 0;
		if (engine.onRelayPublish) engine.onRelayPublish(ev, relayCount);
		return ev;
	};
	function handleRelaySwapEvent(ev, relayUrl, source, expectedSwapId) {
		var eventId = ev && ev.id ? ev.id : '';
		try {
			var env = NOSTR.validateEnvelope(ev);
			if (expectedSwapId && env.swapId !== expectedSwapId) {
				debugRelay('drop ' + source + ' event ' + (eventId ? eventId.slice(0, 12) + '…' : 'unknown') + ' from ' + relayUrl + ': swapId mismatch ' + env.swapId.slice(0, 12) + '…');
				return;
			}
			if (seen[eventId]) {
				debugRelay('duplicate ' + source + ' ' + env.type + ' ' + env.swapId.slice(0, 12) + '… from ' + relayUrl);
				return;
			}
			seen[eventId] = true;
			debugRelay('event ' + source + ' ' + env.type + ' ' + env.swapId.slice(0, 12) + '… kind ' + ev.kind + ' from ' + relayUrl + ' sig=' + (!!ev.sig));
			try { SWAP.addMessage(env.swapId, ev); }
			catch (messageError) { debugRelay('message pre-store skipped for ' + env.type + ' ' + env.swapId.slice(0, 12) + '…: ' + (messageError.message || messageError)); }
			if (engine.onSwapMessage) engine.onSwapMessage(env, ev);
		} catch (error) {
			debugRelay('reject ' + source + ' event ' + (eventId ? eventId.slice(0, 12) + '…' : 'unknown') + ' from ' + relayUrl + ': ' + (error.message || error));
		}
	}
	engine.startListening = function (force) {
		if (!engine.pool) engine.startRelays();
		engine._wantListening = true;
		if (engine._listenHandler && !force) return;
		engine._listenHandler = function (ev, relayUrl) {
			handleRelaySwapEvent(ev, relayUrl || 'unknown relay', 'global', '');
		};
		var subId = engine.pool.sub({ kinds: otcKinds(), limit: 500 }, engine._listenHandler);
		if (engine.onRelaySubscription) engine.onRelaySubscription(subId, { kinds: otcKinds(), limit: 500 }, 'global');
	};

	engine.trackSwapId = function (swapId) {
		if (!engine.pool) engine.startRelays();
		engine.startListening();
		var cleanSwapId = $.trim(swapId || '');
		if (!/^[0-9a-f]{64}$/i.test(cleanSwapId)) {
			throw new Error('Swap ID must be a 64-character hex value');
		}
		engine.trackedSwapIds = engine.trackedSwapIds || {};
		engine.trackedSwapIds[cleanSwapId] = true;
		var dFilter = { kinds: otcKinds(), '#d': [cleanSwapId], limit: 500 };
		var dSub = engine.pool.sub(dFilter, function (ev, relayUrl) {
			handleRelaySwapEvent(ev, relayUrl || 'unknown relay', '#d', cleanSwapId);
		});
		if (engine.onRelaySubscription) engine.onRelaySubscription(dSub, dFilter, '#d');
		var swapIdFilter = { kinds: otcKinds(), '#swapId': [cleanSwapId], limit: 500 };
		var swapIdSub = engine.pool.sub(swapIdFilter, function (ev, relayUrl) {
			handleRelaySwapEvent(ev, relayUrl || 'unknown relay', '#swapId', cleanSwapId);
		});
		if (engine.onRelaySubscription) engine.onRelaySubscription(swapIdSub, swapIdFilter, '#swapId');
		return swapIdSub;
	};

	/* ============ Tx helpers ============ */
	engine.withChain = function (cc, fn) { return CHAINS.withChain(cc, fn); };
	function withChain(cc, fn) { return engine.withChain(cc, fn); }
	function txidFromHex(txhex) {
		var first = Crypto.SHA256(Crypto.util.hexToBytes(txhex), { asBytes: true });
		return Crypto.util.bytesToHex(Crypto.SHA256(first, { asBytes: true }).reverse());
	}
	function promiseFromCoinCallback(work) {
		var d = $.Deferred();
		try { work(function (response) { response && response.success ? d.resolve(response) : d.reject((response && response.error) || 'Chain request failed'); }); }
		catch (error) { d.reject(error.message || String(error)); }
		return d.promise();
	}
	function scriptForAddress(address) {
		return Crypto.util.bytesToHex(coinjs.script().spendToScript(address).buffer);
	}
	function normalizeAmountSats(value) {
		if (typeof value === 'number') {
			return value > 21000000 ? Math.round(value) : Math.round(value * 100000000);
		}
		return CHAINS.decimalToSats(value);
	}
	engine.listUnspent = function (cc, address) {
		return withChain(cc, function () {
			return promiseFromCoinCallback(function (done) { coinjs.transaction().listUnspent(address, done); });
		});
	};
	engine.broadcastTx = function (cc, txhex) {
		return withChain(cc, function () {
			return promiseFromCoinCallback(function (done) { coinjs.transaction().broadcast(done, txhex); });
		});
	};
	engine.getTransaction = function (cc, txid) {
		return withChain(cc, function () {
			return promiseFromCoinCallback(function (done) { coinjs.transaction().getTransaction(txid, done); });
		});
	};
	engine.findFundingOutput = function (cc, txid, expectedAddress, expectedAmount) {
		var expectedSats = CHAINS.decimalToSats(expectedAmount);
		return withChain(cc, function () {
			var expectedScript = scriptForAddress(expectedAddress);
			return engine.getTransaction(cc, txid).then(function (response) {
				var outputs = response.data || [];
				for (var i = 0; i < outputs.length; i++) {
					var output = outputs[i];
					var outputSats = normalizeAmountSats(output.value);
					if ((output.address === expectedAddress || output.script_pub_key_hex === expectedScript) && outputSats === expectedSats) {
						return {
							chainCode: cc,
							txid: txid,
							vout: output.vout,
							amount: CHAINS.satsToDecimal(outputSats),
							value: outputSats,
							address: expectedAddress,
							scriptPubKey: output.script_pub_key_hex,
							confirmations: output.confirmations || 0,
							verifiedAt: new Date().toISOString()
						};
					}
				}
				throw new Error(cc + ' funding output not found for ' + expectedAddress + ' amount ' + expectedAmount);
			});
		});
	};
	engine.buildFundingTx = function (cc, sourceWif, destinationAddress, amountDecimal, feeDecimal) {
		var wallet = CHAINS.getWalletMaterialForChain(sourceWif, cc);
		var amountSats = CHAINS.decimalToSats(amountDecimal);
		var feeSats = CHAINS.decimalToSats(feeDecimal || '0.00001000');
		return engine.listUnspent(cc, wallet.address).then(function (response) {
			return withChain(cc, function () {
				var tx = coinjs.transaction();
				var selected = [], total = 0, utxos = response.data || [];
				for (var i = 0; i < utxos.length && total < amountSats + feeSats; i++) {
					var utxo = utxos[i];
					var value = normalizeAmountSats(utxo.value);
					if (!utxo.transaction_hash || utxo.vout == null || value <= 0) continue;
					tx.addinput(utxo.transaction_hash, utxo.vout, utxo.script_pub_key_hex || '', 0xffffffff);
					selected.push({ txid: utxo.transaction_hash, vout: utxo.vout, value: value });
					total += value;
				}
				if (total < amountSats + feeSats) throw new Error('Insufficient ' + cc + ' UTXOs: need ' + CHAINS.satsToDecimal(amountSats + feeSats) + ', selected ' + CHAINS.satsToDecimal(total));
				tx.addoutput(destinationAddress, CHAINS.satsToDecimal(amountSats));
				var change = total - amountSats - feeSats;
				if (change > 546) tx.addoutput(wallet.address, CHAINS.satsToDecimal(change));
				tx.sign(sourceWif);
				var txhex = tx.serialize();
				return { chainCode: cc, txhex: txhex, txid: txidFromHex(txhex), sourceAddress: wallet.address, destinationAddress: destinationAddress, amount: CHAINS.satsToDecimal(amountSats), fee: CHAINS.satsToDecimal(feeSats), selectedUtxos: selected, change: CHAINS.satsToDecimal(change > 0 ? change : 0) };
			});
		});
	};
	engine.buildClaimTxFromFunding = function (cc, fundingEvidence, redeemScript, destinationAddress, feeDecimal) {
		return withChain(cc, function () {
			var amountSats = normalizeAmountSats(fundingEvidence.value || fundingEvidence.amount);
			var feeSats = CHAINS.decimalToSats(feeDecimal || '0.00001000');
			if (amountSats <= feeSats) throw new Error('Claim amount does not cover fee');
			var tx = coinjs.transaction();
			tx.addinput(fundingEvidence.txid, fundingEvidence.vout, redeemScript, 0xffffffff);
			tx.addoutput(destinationAddress, CHAINS.satsToDecimal(amountSats - feeSats));
			return tx;
		});
	};
	engine.signClaimTx = function (cc, tx, wif) { return withChain(cc, function () { return tx.transactionSig(0, wif, 1); }); };
	engine.applyMultisigSignatures = function (cc, tx, redeemScript, signatures) {
		return withChain(cc, function () {
			var script = coinjs.script();
			script.writeOp(0);
			for (var i = 0; i < signatures.length; i++) script.writeBytes(Crypto.util.hexToBytes(signatures[i]));
			script.writeBytes(Crypto.util.hexToBytes(redeemScript));
			tx.ins[0].script = script;
			return tx;
		});
	};
	engine.buildClaimTx = function (cc, txid, vout, rs, amt, addr, fee) {
		return withChain(cc, function () {
			var tx = coinjs.transaction(); tx.addinput(txid, vout, rs, 0xffffffff);
			tx.addoutput(addr, parseFloat(amt) - parseFloat(fee)); return tx;
		});
	};
	engine.sighash = function (tx) { return Crypto.util.hexToBytes(tx.transactionHash(0, 1)); };
	engine.signOrd = function (tx, wif) { return tx.transactionSig(0, wif, 1); };
	engine.makeAdaptorSig = function (sess, tx) {
		return coinjs.adaptor.encrypt({ messageHash: engine.sighash(tx), signingPrivateKey: sess.localChildPrivateKey, adaptorPublicKey: sess.adaptorPoint, auxiliaryRandomness: coinjs.newPrivkey() });
	};
	engine.completeSig = function (asig, secret) { return coinjs.adaptor.complete({ adaptorSignature: asig, adaptorSecret: secret }).hex; };
	engine.recoverSecret = function (asig, csig, Y) { return coinjs.adaptor.recover({ adaptorSignature: asig, completedSignature: Crypto.util.hexToBytes(csig), adaptorPublicKey: Y }); };

	/* ============ Persistent sessions ============ */
	var LIVE = 'rodOtcLive';
	engine.saveLive = function (sess) {
		var all = engine.loadLive(), c = $.extend(true, {}, sess), pw = engine.walletPassword();
		if (c.localChildPrivateKey && pw) { c._ep = CryptoJS.AES.encrypt(c.localChildPrivateKey, pw).toString(); delete c.localChildPrivateKey; }
		if (c.adaptorSecret && pw) { c._ea = CryptoJS.AES.encrypt(c.adaptorSecret, pw).toString(); delete c.adaptorSecret; }
		if (c.localNostrPrivateKey && pw) { c._en = CryptoJS.AES.encrypt(c.localNostrPrivateKey, pw).toString(); delete c.localNostrPrivateKey; }
		all[sess.swapId] = c; localStorage.setItem(LIVE, JSON.stringify(all));
	};
	engine.loadLive = function () { try { return JSON.parse(localStorage.getItem(LIVE)) || {}; } catch (e) { return {}; } };
	engine.restoreLive = function (id) {
		var all = engine.loadLive(), s = all[id]; if (!s) return null;
		var pw = engine.walletPassword();
		if (s._ep && pw) { try { s.localChildPrivateKey = CryptoJS.AES.decrypt(s._ep, pw).toString(CryptoJS.enc.Utf8); } catch (e) {} }
		if (s._ea && pw) { try { s.adaptorSecret = CryptoJS.AES.decrypt(s._ea, pw).toString(CryptoJS.enc.Utf8); } catch (e) {} }
		if (s._en && pw) { try { s.localNostrPrivateKey = CryptoJS.AES.decrypt(s._en, pw).toString(CryptoJS.enc.Utf8); } catch (e) {} }
		return s;
	};
	engine.removeLive = function (id) { var a = engine.loadLive(); delete a[id]; localStorage.setItem(LIVE, JSON.stringify(a)); };

	/* ============ Trade history ============ */
	var HK = 'rodOtcHistory';
	engine.getHistory = function () { try { return JSON.parse(localStorage.getItem(HK)) || []; } catch (e) { return []; } };
	engine.recordTrade = function (s) {
		var h = engine.getHistory();
		h.unshift({ swapId: s.swapId, orderId: s.orderId, role: s.role, state: s.state, pair: 'ROD/LTC', rodAmount: s.terms.rodAmount, ltcAmount: s.terms.ltcAmount, rodFundingTxid: s.execution && s.execution.rodFunding && s.execution.rodFunding.txid || '', ltcFundingTxid: s.execution && s.execution.ltcFunding && s.execution.ltcFunding.txid || '', ltcClaimTxid: s.execution && s.execution.ltcClaim && s.execution.ltcClaim.txid || '', rodClaimTxid: s.execution && s.execution.rodClaim && s.execution.rodClaim.txid || '', completedAt: new Date().toISOString() });
		if (h.length > 100) h = h.slice(0, 100);
		localStorage.setItem(HK, JSON.stringify(h));
	};
	engine.clearHistory = function () { localStorage.removeItem(HK); };

	/* ============ Orderbook scanner ============ */
	engine.orderbook = [];
	/* Only OTC order names in the ROD name DB */
	engine.OTC_NAME_REGEXP = '^d/otc-swap/';
	engine.OTC_NAME_PREFIX = 'd/otc-swap/';

	engine.scanNames = function (names) {
		var d = $.Deferred(), offers = [], reports = [], pending = names.length;
		if (!pending) {
			d.resolve({ offers: [], reports: [] });
			return d;
		}
		names.forEach(function (n) {
			engine.nameLookup(n).then(function (v) {
				var norm = engine.normalizeOffer(n, v);
				if (norm.ok) {
					offers.push(norm.offer);
					reports.push({ name: n, ok: true, detail: 'ok · ' + norm.offer.side + ' ' + norm.offer.give + ' ROD / ' + norm.offer.want + ' LTC' });
				} else {
					reports.push({ name: n, ok: false, detail: norm.reason || 'rejected' });
				}
			}, function (err) {
				var msg = (err && err.message) ? err.message : (typeof err === 'string' ? err : 'lookup failed');
				reports.push({ name: n, ok: false, detail: msg });
			}).always(function () {
				if (--pending <= 0) {
					engine.orderbook = offers;
					d.resolve({ offers: offers, reports: reports });
				}
			});
		});
		return d;
	};

	/**
	 * Query ROD name DB for OTC orders: name_scan with regexp ^d/otc-swap/
	 * Paginates until exhausted or maxNames reached.
	 */
	engine.scanOtcOrdersFromDb = function (opts) {
		var d = $.Deferred();
		var options = opts || {};
		var regexp = options.regexp || engine.OTC_NAME_REGEXP;
		var pageSize = options.pageSize || 500;
		var maxNames = options.maxNames || 5000;
		var c = engine.loadConfig();
		if (!$.trim(c.rpcUrl || '')) {
			d.reject('ROD Core RPC is not configured — set it in OTC Settings and run the CORS proxy');
			return d.promise();
		}

		var offers = [];
		var reports = [];
		var start = options.start != null ? options.start : 'd/otc-swap/';
		var collected = 0;
		var seen = {};

		function page(startName) {
			engine.rpc('name_scan', [startName, pageSize, { regexp: regexp }]).then(function (rows) {
				var list = coinjs.isArray(rows) ? rows : [];
				if (!list.length) {
					engine.orderbook = offers;
					d.resolve({ offers: offers, reports: reports, scanned: collected, regexp: regexp });
					return;
				}
				var lastName = '';
				var newInPage = 0;
				for (var i = 0; i < list.length; i++) {
					var row = list[i] || {};
					var n = row.name || row.name_error || '';
					if (!n) continue;
					lastName = n;
					if (seen[n]) continue;
					seen[n] = true;
					newInPage++;
					/* Defence in depth: only d/otc-swap/ names */
					if (!/^d\/otc-swap\//.test(n)) {
						reports.push({ name: n, ok: false, detail: 'skipped (name does not match ^d/otc-swap/)' });
						continue;
					}
					collected++;
					var value = null;
					if (row.value_error) {
						reports.push({ name: n, ok: false, detail: 'value error: ' + row.value_error });
						continue;
					}
					if (typeof row.value === 'string') {
						try { value = JSON.parse(row.value); }
						catch (e) { reports.push({ name: n, ok: false, detail: 'invalid JSON value' }); continue; }
					} else if (row.value && typeof row.value === 'object') {
						value = row.value;
					} else {
						value = engine.extractNameValue(row);
					}
					var norm = engine.normalizeOffer(n, value);
					if (norm.ok) {
						offers.push(norm.offer);
						reports.push({
							name: n,
							ok: true,
							detail: 'ok · ' + norm.offer.side + ' ' + norm.offer.give + ' ROD / ' + norm.offer.want + ' LTC'
						});
					} else {
						reports.push({ name: n, ok: false, detail: norm.reason || 'rejected' });
					}
				}
				if (!newInPage || list.length < pageSize || collected >= maxNames || !lastName) {
					engine.orderbook = offers;
					d.resolve({ offers: offers, reports: reports, scanned: collected, regexp: regexp });
					return;
				}
				/* Continue strictly after lastName */
				page(lastName + '\u0000');
			}, function (err) {
				d.reject(err);
			});
		}

		page(start);
		return d.promise();
	};
})();
