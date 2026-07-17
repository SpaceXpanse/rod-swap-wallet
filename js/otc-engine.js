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
		this.n = 0;
		this.onStatus = null;
		this.closed = false;
	}
	Pool.prototype.connect = function () { var s = this; this.urls.forEach(function (u) { s._open(u); }); };
	Pool.prototype._open = function (u) {
		var s = this;
		if (s.closed) return;
		if (s.ws[u] && s.ws[u].readyState <= 1) return;
		try {
			var w = new WebSocket(u);
			w.onopen = function () { if (s.closed) { try { w.close(); } catch (e0) {} return; } if (s.onStatus) s.onStatus('+', u); for (var id in s.h) if (s.h[id].f) w.send(JSON.stringify(['REQ', id, s.h[id].f])); };
			w.onmessage = function (m) { try { var d = JSON.parse(m.data); if (d[0] === 'EVENT' && s.h[d[1]]) s.h[d[1]].cb(d[2], u); } catch (e) {} };
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
	Pool.prototype.pub = function (ev) { var f = JSON.stringify(['EVENT', ev]), n = 0; for (var u in this.ws) if (this.ws[u].readyState === 1) { this.ws[u].send(f); n++; } return n; };
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
		var ev = SWAP.createEnvelopeForSession(sess, type, payload, sess.role + '-peer');
		SWAP.addMessage(sess.swapId, ev);
		if (engine.pool) engine.pool.pub(ev);
		return ev;
	};
	engine.startListening = function (force) {
		if (!engine.pool) engine.startRelays();
		engine._wantListening = true;
		if (engine._listenHandler && !force) return;
		engine._listenHandler = function (ev) {
			if (seen[ev.id]) return; seen[ev.id] = true;
			try {
				var env = NOSTR.validateEnvelope(ev);
				try { SWAP.addMessage(env.swapId, ev); } catch (e) {}
				if (engine.onSwapMessage) engine.onSwapMessage(env, ev);
			} catch (e) {}
		};
		engine.pool.sub({ kinds: [33440], limit: 500 }, engine._listenHandler);
	};

	/* ============ Tx helpers ============ */
	function withChain(cc, fn) {
		var d = CHAINS.definitions[cc], s = { pub: coinjs.pub, priv: coinjs.priv, multisig: coinjs.multisig };
		coinjs.pub = d.pub; coinjs.priv = d.priv; coinjs.multisig = d.multisig;
		try { return fn(); } finally { coinjs.pub = s.pub; coinjs.priv = s.priv; coinjs.multisig = s.multisig; }
	}
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
		all[sess.swapId] = c; localStorage.setItem(LIVE, JSON.stringify(all));
	};
	engine.loadLive = function () { try { return JSON.parse(localStorage.getItem(LIVE)) || {}; } catch (e) { return {}; } };
	engine.restoreLive = function (id) {
		var all = engine.loadLive(), s = all[id]; if (!s) return null;
		var pw = engine.walletPassword();
		if (s._ep && pw) { try { s.localChildPrivateKey = CryptoJS.AES.decrypt(s._ep, pw).toString(CryptoJS.enc.Utf8); } catch (e) {} }
		if (s._ea && pw) { try { s.adaptorSecret = CryptoJS.AES.decrypt(s._ea, pw).toString(CryptoJS.enc.Utf8); } catch (e) {} }
		return s;
	};
	engine.removeLive = function (id) { var a = engine.loadLive(); delete a[id]; localStorage.setItem(LIVE, JSON.stringify(a)); };

	/* ============ Trade history ============ */
	var HK = 'rodOtcHistory';
	engine.getHistory = function () { try { return JSON.parse(localStorage.getItem(HK)) || []; } catch (e) { return []; } };
	engine.recordTrade = function (s) {
		var h = engine.getHistory();
		h.unshift({ swapId: s.swapId, orderId: s.orderId, role: s.role, state: s.state, pair: 'ROD/LTC', rodAmount: s.terms.rodAmount, ltcAmount: s.terms.ltcAmount, completedAt: new Date().toISOString() });
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
