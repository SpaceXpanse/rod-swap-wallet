/*
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 SpaceXpanse
 *
 * otc-explorer.js — pluggable block-explorer adapter.
 *
 * The wallet's chain code was written against the Blockstream Esplora REST
 * shape, which Litecoin has a public instance of and Dogecoin does not. Rather
 * than fork every call site per chain, this module normalises each supported
 * backend INTO the Esplora shape, so everything downstream keeps consuming one
 * response format:
 *
 *   utxos(network, address)      -> [ {txid, vout, value, scriptpubkey} ]
 *   balance(network, address)    -> <int base units>
 *   tx(network, txid)            -> { txid, vin[], vout[], status{}, hex }
 *   txHex(network, txid)         -> "<raw hex>"
 *   outspend(network, txid, n)   -> { spent, txid }
 *   tipHeight(network)           -> <int>
 *   broadcast(network, hex)      -> { success, txid, error }
 *
 * Values are ALWAYS integer base units (satoshi / koinu) — never coin floats.
 *
 * Backends
 * --------
 * esplora      Blockstream Esplora and its forks (litecoinspace.org for LTC,
 *              mempool.space for BTC; a self-hosted electrs for DOGE/BCH).
 *              Native shape, passthrough.
 * blockcypher  The default for Dogecoin: the only keyless public API serving
 *              permissive CORS, raw transaction hex AND a spending-tx lookup,
 *              all three of which this protocol requires.
 * blockchair   The default for Bitcoin Cash: the only keyless API with CORS,
 *              raw hex, and spending-tx lookup for BCH. Can also serve BTC
 *              and other chains if operators prefer it.
 *
 * Load order: after coin.js (needs coinjs.ajax) and before any module that
 * performs chain I/O.
 */
(function () {
	'use strict';

	var explorer = coinjs.explorer = {};

	function deferred() { return jQuery.Deferred(); }

	function toInt(value, fallback) {
		var parsed = parseInt(value, 10);
		return isFinite(parsed) ? parsed : (fallback === undefined ? 0 : fallback);
	}

	/* Base units only. Some backends return decimal STRINGS whose coin value can
	   exceed Number.MAX_SAFE_INTEGER on a chain with Dogecoin's supply, so a
	   plain parseInt on a coin-denominated string would silently lose precision.
	   Anything containing '.' is coin-denominated and converted exactly. */
	function baseUnits(value) {
		if (typeof value === 'number') {
			if (!isFinite(value)) throw new Error('Invalid amount: ' + value);
			return Math.round(value);
		}
		var text = String(value == null ? '0' : value).replace(/^\s+|\s+$/g, '');
		if (text.indexOf('.') !== -1) {
			var parts = text.split('.');
			var whole = toInt(parts[0], 0);
			var fraction = (parts[1] || '').substring(0, 8);
			while (fraction.length < 8) fraction += '0';
			return whole * 100000000 + toInt(fraction, 0);
		}
		return toInt(text, 0);
	}

	/* ------------------------------------------------------------------
	   In-flight request coalescing.

	   The automation re-drives every live session on a timer, and several
	   sessions on the same chain ask for the same tip height or the same
	   transaction within one tick. Those duplicate GETs are merged into a
	   single HTTP request, which matters on BlockCypher's keyless tier
	   (~100 requests/hour per source IP).

	   This is deliberately NOT a time-based cache. A response is shared only
	   while its request is still outstanding, so a caller can never observe a
	   value that was already stale when it asked — which in a swap is the
	   difference between seeing a counterparty's claim in time to recover the
	   secret and missing it. It also cannot pin a failure: coinjs.ajax has no
	   error channel (it invokes its success callback with the body of a 4xx,
	   a 5xx or a timeout), so an errored response resolves like any other and
	   a TTL cache would have held it for the full TTL.
	   ------------------------------------------------------------------ */

	var inFlight = {};

	function get(url) {
		if (inFlight[url]) return inFlight[url];
		var d = deferred();
		inFlight[url] = d.promise();
		coinjs.ajax(url, function (response) {
			delete inFlight[url];
			d.resolve(response);
		}, 'GET');
		return inFlight[url];
	}

	function getJson(url) {
		return get(url).then(function (response) {
			var parsed;
			try {
				parsed = JSON.parse(response);
			} catch (e) {
				return deferred().reject('Invalid JSON from ' + url).promise();
			}
			if (parsed && parsed.error && !parsed.data) {
				var message = (parsed.error && parsed.error.message) ? parsed.error.message : String(parsed.error);
				return deferred().reject(message).promise();
			}
			return parsed;
		});
	}

	function getText(url) {
		return get(url).then(function (response) {
			return String(response == null ? '' : response).replace(/^\s+|\s+$/g, '');
		});
	}

	function postRaw(url, body, contentType) {
		var d = deferred();
		coinjs.ajax(url, function (response) {
			d.resolve(String(response == null ? '' : response));
		}, 'POST', { body: body, contentType: contentType || 'text/plain' });
		return d.promise();
	}

	/* ------------------------------------------------------------------
	   Driver: Esplora (native shape)
	   ------------------------------------------------------------------ */

	var esploraDriver = {
		name: 'esplora',
		utxos: function (base, address) {
			return getJson(base + '/address/' + encodeURIComponent(address) + '/utxo').then(function (list) {
				if (!coinjs.isArray(list)) {
					return deferred().reject('Unexpected utxo response').promise();
				}
				var out = [];
				for (var i = 0; i < list.length; i++) {
					var u = list[i];
					out.push({
						txid: u.txid || u.transaction_hash,
						vout: (typeof u.vout !== 'undefined') ? u.vout : u.index,
						value: baseUnits(u.value),
						scriptpubkey: u.scriptpubkey || u.script || '',
						confirmations: (u.status && u.status.confirmed) ? 1 : (u.confirmations || 0)
					});
				}
				return out;
			});
		},
		balance: function (base, address) {
			return getJson(base + '/address/' + encodeURIComponent(address)).then(function (data) {
				var chain = data.chain_stats || {};
				var mempool = data.mempool_stats || {};
				var funded = toInt(chain.funded_txo_sum, 0) + toInt(mempool.funded_txo_sum, 0);
				var spent = toInt(chain.spent_txo_sum, 0) + toInt(mempool.spent_txo_sum, 0);
				return funded - spent;
			});
		},
		tx: function (base, txid) {
			return getJson(base + '/tx/' + encodeURIComponent(txid));
		},
		txHex: function (base, txid) {
			return getText(base + '/tx/' + encodeURIComponent(txid) + '/hex').then(function (hex) {
				if (!/^[0-9a-f]+$/i.test(hex)) {
					return deferred().reject('Invalid tx hex response').promise();
				}
				return hex;
			});
		},
		outspend: function (base, txid, vout) {
			return getJson(base + '/tx/' + encodeURIComponent(txid) + '/outspend/' + toInt(vout, 0));
		},
		tipHeight: function (base) {
			return getText(base + '/blocks/tip/height').then(function (body) {
				/* Strict parse. coinjs.ajax hands 4xx/5xx bodies to the success
				   path, so stripping non-digits from an HTML error page used to
				   yield a plausible height ("502 Bad Gateway" -> 502) and a
				   bogus tip silently withholds a matured timelocked refund. */
				var text = String(body == null ? '' : body).replace(/^\s+|\s+$/g, '').replace(/^"|"$/g, '');
				if (!/^[0-9]{1,9}$/.test(text)) return deferred().reject('Invalid tip height: ' + text).promise();
				var height = parseInt(text, 10);
				if (height <= 0) return deferred().reject('Invalid tip height: ' + text).promise();
				return height;
			});
		},
		broadcast: function (base, txhex) {
			return postRaw(base + '/tx', txhex, 'text/plain').then(function (body) {
				var text = body.replace(/^"|"$/g, '');
				if (/^[a-fA-F0-9]{64}$/.test(text)) {
					return { success: true, txid: text, error: '', raw: body };
				}
				var message = text || 'Broadcast failed';
				try {
					var parsed = JSON.parse(text);
					if (parsed && (parsed.error || parsed.message)) message = parsed.error || parsed.message;
				} catch (e) { /* Esplora returns plain-text errors */ }
				return { success: false, txid: '', error: message, raw: body };
			});
		}
	};

	/* ------------------------------------------------------------------
	   Driver: BlockCypher

	   Docs: https://www.blockcypher.com/dev/bitcoin/
	   Base: https://api.blockcypher.com/v1/doge/main
	   All amounts are integer base units. block_height is -1 while unconfirmed.
	   ------------------------------------------------------------------ */

	function blockcypherTxToEsplora(tx) {
		var inputs = tx.inputs || [];
		var outputs = tx.outputs || [];
		var vin = [];
		for (var i = 0; i < inputs.length; i++) {
			vin.push({
				txid: inputs[i].prev_hash || '',
				vout: toInt(inputs[i].output_index, 0),
				scriptsig: inputs[i].script || '',
				sequence: toInt(inputs[i].sequence, 0xffffffff),
				prevout: {
					value: baseUnits(inputs[i].output_value || 0),
					scriptpubkey_address: (inputs[i].addresses && inputs[i].addresses[0]) || ''
				}
			});
		}
		var vout = [];
		for (var j = 0; j < outputs.length; j++) {
			vout.push({
				n: j,
				value: baseUnits(outputs[j].value),
				scriptpubkey: outputs[j].script || '',
				scriptpubkey_address: (outputs[j].addresses && outputs[j].addresses[0]) || '',
				/* preserved so outspend() can answer without a second request */
				spent_by: outputs[j].spent_by || ''
			});
		}
		var height = toInt(tx.block_height, -1);
		var confirmed = height > 0;
		return {
			txid: tx.hash || tx.txid || '',
			version: toInt(tx.ver, 1),
			locktime: toInt(tx.lock_time, 0),
			size: toInt(tx.size, 0),
			fee: baseUnits(tx.fees || 0),
			vin: vin,
			vout: vout,
			hex: tx.hex || '',
			/* Never carry a reported confirmation count for a transaction that
			   is not in a block: BlockCypher returns block_height -1 alongside
			   a non-zero "confirmations" for mempool entries, which would make
			   a mempool-only (or fabricated) funding read as deeply confirmed. */
			confirmations: confirmed ? toInt(tx.confirmations, 1) : 0,
			status: { confirmed: confirmed, block_height: confirmed ? height : 0 }
		};
	}

	function blockcypherTxUrl(base, txid) {
		return base + '/txs/' + encodeURIComponent(txid) + '?includeHex=true&limit=200';
	}

	var blockcypherDriver = {
		name: 'blockcypher',
		utxos: function (base, address) {
			var url = base + '/addrs/' + encodeURIComponent(address) + '?unspentOnly=true&includeScript=true&limit=2000';
			return getJson(url).then(function (data) {
				var refs = (data.txrefs || []).concat(data.unconfirmed_txrefs || []);
				var out = [];
				for (var i = 0; i < refs.length; i++) {
					var r = refs[i];
					/* unspentOnly is advisory on some deployments — filter again. */
					if (r.spent === true) continue;
					out.push({
						txid: r.tx_hash,
						vout: toInt(r.tx_output_n, 0),
						value: baseUnits(r.value),
						scriptpubkey: r.script || '',
						confirmations: toInt(r.confirmations, 0)
					});
				}
				return out;
			});
		},
		balance: function (base, address) {
			return getJson(base + '/addrs/' + encodeURIComponent(address) + '/balance').then(function (data) {
				return baseUnits(data.final_balance != null ? data.final_balance : (data.balance || 0));
			});
		},
		tx: function (base, txid) {
			return getJson(blockcypherTxUrl(base, txid)).then(blockcypherTxToEsplora);
		},
		txHex: function (base, txid) {
			return blockcypherDriver.tx(base, txid).then(function (tx) {
				if (tx.hex && /^[0-9a-f]+$/i.test(tx.hex)) return tx.hex;
				return deferred().reject('BlockCypher returned no tx hex for ' + txid).promise();
			});
		},
		outspend: function (base, txid, vout) {
			/* BlockCypher marks a spent output with spent_by; the field is
			   omitted entirely while the output is still unspent. */
			return blockcypherDriver.tx(base, txid).then(function (tx) {
				var out = tx.vout[toInt(vout, 0)];
				if (!out) return { spent: false };
				return out.spent_by ? { spent: true, txid: out.spent_by } : { spent: false };
			});
		},
		tipHeight: function (base) {
			return getJson(base).then(function (data) {
				var height = toInt(data.height, 0);
				if (height <= 0) return deferred().reject('Invalid BlockCypher tip height').promise();
				return height;
			});
		},
		broadcast: function (base, txhex) {
			return postRaw(base + '/txs/push', JSON.stringify({ tx: txhex }), 'application/json')
				.then(function (body) {
					var parsed;
					try {
						parsed = JSON.parse(body);
					} catch (e) {
						return { success: false, txid: '', error: body || 'Broadcast failed', raw: body };
					}
					var txid = (parsed && parsed.tx && (parsed.tx.hash || parsed.tx.txid)) || parsed.hash || '';
					if (txid) return { success: true, txid: txid, error: '', raw: parsed };
					var message = parsed.error || parsed.errors || 'Broadcast failed';
					if (typeof message !== 'string') message = JSON.stringify(message);
					return { success: false, txid: '', error: message, raw: parsed };
				});
		}
	};

	/* ------------------------------------------------------------------
	   Driver: Blockchair

	   Docs: https://blockchair.com/api/docs
	   Base: https://api.blockchair.com/bitcoin-cash (or /bitcoin, etc.)
	   The only keyless public API serving CORS, raw transaction hex AND a
	   spending-tx lookup for Bitcoin Cash. All amounts are integer satoshis.

	   Blockchair's JSON is deeply nested under data[key]; the mapping below
	   normalises it into the Esplora shape the rest of the wallet expects.
	   ------------------------------------------------------------------ */

	/* Blockchair models a transaction's INPUTS as the output records it consumes,
	   so each input carries BOTH ends of the link: transaction_hash / index are
	   the PREVOUT (what Esplora calls vin[].txid / vin[].vout), while
	   spending_* describe this very transaction. Reading spending_transaction_hash
	   as the prevout would make every vin point at itself. */
	function blockchairTxToEsplora(txData) {
		var transaction = txData.transaction || {};
		var inputs = txData.inputs || [];
		var outputs = txData.outputs || [];
		var vin = [];
		for (var i = 0; i < inputs.length; i++) {
			vin.push({
				txid: inputs[i].transaction_hash || '',
				vout: toInt(inputs[i].index, 0),
				scriptsig: inputs[i].spending_signature_hex || '',
				sequence: toInt(inputs[i].spending_sequence, 0xffffffff),
				prevout: {
					value: baseUnits(inputs[i].value || 0),
					scriptpubkey_address: inputs[i].recipient || ''
				}
			});
		}
		/* Index by Blockchair's DECLARED output index, not by array position.
		   The API does not promise ordering, and an off-by-position vout makes
		   outspend() report on the wrong output - which on the alt leg means
		   the counterparty's claim is never fetched and the adaptor secret is
		   never recovered, degrading a completable swap into a refund race. */
		var vout = [];
		for (var j = 0; j < outputs.length; j++) {
			var outIndex = toInt(outputs[j].index, j);
			vout[outIndex] = {
				n: outIndex,
				value: baseUnits(outputs[j].value),
				scriptpubkey: outputs[j].script_hex || '',
				scriptpubkey_address: outputs[j].recipient || '',
				/* preserve for outspend lookup */
				spending_transaction_hash: outputs[j].spending_transaction_hash || ''
			};
		}
		for (var k = 0; k < vout.length; k++) {
			if (!vout[k]) vout[k] = { n: k, value: 0, scriptpubkey: '', scriptpubkey_address: '', spending_transaction_hash: '' };
		}
		var height = toInt(transaction.block_id, -1);
		var confirmed = height > 0;
		return {
			txid: transaction.hash || '',
			version: toInt(transaction.version, 1),
			locktime: toInt(transaction.lock_time, 0),
			size: toInt(transaction.size, 0),
			fee: baseUnits(transaction.fee || 0),
			vin: vin,
			vout: vout,
			hex: '',
			confirmations: confirmed ? 1 : 0,
			status: { confirmed: confirmed, block_height: confirmed ? height : 0 }
		};
	}

	var blockchairDriver = {
		name: 'blockchair',
		/* limit is "{transactions},{utxo}" on this endpoint. We never read the
		   transaction list, but the utxo cap must stay high — a bare limit=0
		   would return an EMPTY utxo array, which reads as "address unfunded"
		   and would stall a swap waiting for funding that already landed. */
		utxos: function (base, address) {
			return getJson(base + '/dashboards/address/' + encodeURIComponent(address) + '?limit=0,10000').then(function (resp) {
				var data = resp && resp.data && resp.data[address];
				if (!data) return deferred().reject('Unexpected Blockchair address response').promise();
				var utxoList = data.utxo || [];
				var out = [];
				for (var i = 0; i < utxoList.length; i++) {
					var u = utxoList[i];
					out.push({
						txid: u.transaction_hash || '',
						vout: toInt(u.index, 0),
						value: baseUnits(u.value),
						scriptpubkey: '',
						confirmations: toInt(u.block_id, -1) > 0 ? 1 : 0
					});
				}
				return out;
			});
		},
		balance: function (base, address) {
			return getJson(base + '/dashboards/address/' + encodeURIComponent(address) + '?limit=0,0').then(function (resp) {
				var data = resp && resp.data && resp.data[address];
				if (!data) return deferred().reject('Unexpected Blockchair balance response').promise();
				return baseUnits((data.address && data.address.balance) || 0);
			});
		},
		tx: function (base, txid) {
			return getJson(base + '/dashboards/transaction/' + encodeURIComponent(txid)).then(function (resp) {
				var txData = resp && resp.data && resp.data[txid];
				if (!txData) return deferred().reject('Transaction not found: ' + txid).promise();
				return blockchairTxToEsplora(txData);
			});
		},
		txHex: function (base, txid) {
			return getJson(base + '/raw/transaction/' + encodeURIComponent(txid)).then(function (resp) {
				var raw = resp && resp.data && resp.data[txid] && resp.data[txid].raw_transaction;
				if (!raw || !/^[0-9a-f]+$/i.test(raw)) {
					return deferred().reject('Blockchair returned no raw tx hex for ' + txid).promise();
				}
				return raw;
			});
		},
		outspend: function (base, txid, vout) {
			return blockchairDriver.tx(base, txid).then(function (tx) {
				var out = tx.vout[toInt(vout, 0)];
				if (!out) return { spent: false };
				return out.spending_transaction_hash
					? { spent: true, txid: out.spending_transaction_hash }
					: { spent: false };
			});
		},
		tipHeight: function (base) {
			return getJson(base + '/stats').then(function (resp) {
				var height = toInt(resp && resp.data && resp.data.blocks, 0);
				if (height <= 0) return deferred().reject('Invalid Blockchair tip height').promise();
				return height;
			});
		},
		broadcast: function (base, txhex) {
			return postRaw(base + '/push/transaction', 'data=' + encodeURIComponent(txhex), 'application/x-www-form-urlencoded')
				.then(function (body) {
					var parsed;
					try {
						parsed = JSON.parse(body);
					} catch (e) {
						return { success: false, txid: '', error: body || 'Broadcast failed', raw: body };
					}
					var txidResult = parsed && parsed.data && parsed.data.transaction_hash;
					if (txidResult) return { success: true, txid: txidResult, error: '', raw: parsed };
					var message = (parsed && parsed.context && parsed.context.error) || 'Broadcast failed';
					return { success: false, txid: '', error: message, raw: parsed };
				});
		}
	};

	explorer.drivers = {
		esplora: esploraDriver,
		blockcypher: blockcypherDriver,
		blockchair: blockchairDriver
	};

	/* ------------------------------------------------------------------
	   Dispatch
	   ------------------------------------------------------------------ */

	explorer.isSupported = function (network) {
		return !!(network && explorer.drivers[network.apiType]);
	};

	function dispatch(network, method, args) {
		var driver = network && explorer.drivers[network.apiType];
		var base = String((network && network.apiBase) || '').replace(/\/+$/, '');
		if (!driver || typeof driver[method] !== 'function' || !base) {
			return deferred().reject(
				'No usable explorer backend for ' + ((network && network.code) || '?') +
				' (apiType ' + ((network && network.apiType) || 'unset') + ')'
			).promise();
		}
		try {
			return jQuery.when(driver[method].apply(driver, [base].concat(args)));
		} catch (e) {
			return deferred().reject((e && e.message) || String(e)).promise();
		}
	}

	explorer.utxos = function (network, address) { return dispatch(network, 'utxos', [address]); };
	explorer.balance = function (network, address) { return dispatch(network, 'balance', [address]); };
	explorer.tx = function (network, txid) { return dispatch(network, 'tx', [txid]); };
	explorer.txHex = function (network, txid) { return dispatch(network, 'txHex', [txid]); };
	explorer.outspend = function (network, txid, vout) { return dispatch(network, 'outspend', [txid, vout]); };
	explorer.tipHeight = function (network) { return dispatch(network, 'tipHeight', []); };
	explorer.broadcast = function (network, txhex) { return dispatch(network, 'broadcast', [txhex]); };
})();
