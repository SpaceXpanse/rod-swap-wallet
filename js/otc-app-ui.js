/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright (c) SpaceXpanse contributors */

$(function () {
	'use strict';
	if (!window.rodOtc || !window.rodOtc.swap) return;
	var SWAP = rodOtc.swap, ENGINE = rodOtc.engine, STORAGE = rodOtc.storage, CHAINS = rodOtc.chains, NOSTR = rodOtc.nostr;
	var $root = $('#otc'); if (!$root.length) return;
	function esc(v) { return $('<span>').text(v == null ? '' : String(v)).html(); }
	function short(id) { return id ? id.slice(0, 12) + '…' : '—'; }
	function ts() { return new Date().toLocaleTimeString(); }
	function rate(rod, ltc) { var r = parseFloat(rod), l = parseFloat(ltc); return (r > 0 && l > 0) ? (l / r).toFixed(8) : '—'; }
	var cfg = ENGINE.loadConfig();

	/* ============ HTML ============ */
	$root.html([
		'<h2>ROD ↔ LTC OTC Swap</h2>',
		'<div id="otcWarn" class="alert alert-warning" style="display:none"><b>Wallet not loaded.</b> Open your wallet in the <a href="#" onclick="$(\'a[href=#wallet]\').tab(\'show\');return false">Wallet tab</a> first. Your wallet key is used for swap authentication and signing.</div>',
		'<div id="otcWalletOk" class="alert alert-success" style="display:none"></div>',
		'<div id="otcFlash" class="alert hidden"></div>',

		/* Tabs */
		'<ul class="nav nav-pills otc-nav" id="otcNav">',
		'<li class="active"><a data-toggle="tab" href="#otcDash"><span class="glyphicon glyphicon-dashboard"></span> Dashboard</a></li>',
		'<li><a data-toggle="tab" href="#otcNew"><span class="glyphicon glyphicon-plus"></span> New swap</a></li>',
		'<li><a data-toggle="tab" href="#otcActive" id="otcActiveTab"><span class="glyphicon glyphicon-eye-open"></span> Active swap</a></li>',
		'<li><a data-toggle="tab" href="#otcHist"><span class="glyphicon glyphicon-time"></span> History</a></li>',
		'<li><a data-toggle="tab" href="#otcCfg"><span class="glyphicon glyphicon-cog"></span> Settings</a></li>',
		'</ul>',

		'<div class="tab-content" style="margin-top:14px">',

		/* ============ DASHBOARD ============ */
		'<div class="tab-pane active" id="otcDash">',

		/* Orderbook */
		'<div class="otc-panel">',
		'<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap">',
		'<h4 style="margin:0">ROD/LTC Orderbook</h4>',
		'<div><small id="otcBookTime" class="text-muted"></small> <button class="btn btn-default btn-xs" id="otcRefreshBook">Refresh</button></div>',
		'</div>',
		'<div class="row" style="margin-top:10px">',
		'<div class="col-md-4">',
		'<div style="color:#62e6a6;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Ask (sell ROD)</div>',
		'<table class="table otc-book-tbl"><thead><tr><th>Price</th><th>ROD vol</th><th>Cumul.</th></tr></thead><tbody id="otcAsks"></tbody></table>',
		'</div>',
		'<div class="col-md-4" style="text-align:center">',
		'<div class="otc-panel" style="padding:16px;margin-top:18px">',
		'<div style="font-size:11px;color:#9ec7db;text-transform:uppercase">Current price</div>',
		'<div id="otcMidPrice" style="font-size:28px;font-weight:700;color:#fff;margin:6px 0">—</div>',
		'<div style="font-size:11px;color:#9ec7db">LTC per ROD</div>',
		'</div>',
		'</div>',
		'<div class="col-md-4">',
		'<div style="color:#f1334a;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Bid (buy ROD)</div>',
		'<table class="table otc-book-tbl"><thead><tr><th>Price</th><th>ROD vol</th><th>Cumul.</th></tr></thead><tbody id="otcBids"></tbody></table>',
		'</div>',
		'</div>',
		/* Expanded offers for selected price */
		'<div id="otcBookDetail" style="display:none;margin-top:10px">',
		'<h5 id="otcBookDetailTitle"></h5>',
		'<table class="table otc-session-table"><thead><tr><th>Seller/Buyer</th><th>ROD</th><th>LTC</th><th>xpub</th><th></th></tr></thead><tbody id="otcBookDetailBody"></tbody></table>',
		'</div>',
		'<div style="margin-top:10px">',
		'<label style="font-size:12px">Orderbook source</label>',
		'<p class="text-muted" style="font-size:11px;margin:0 0 6px">Queries ROD name DB with <code>name_scan</code> and regexp <code>^d/otc-swap/</code> only.</p>',
		'<div id="otcScanReport" style="margin-top:6px;font-size:11px;font-family:monospace;max-height:140px;overflow-y:auto"></div>',
		'</div>',
		'</div>',

		/* Connection status + active swaps */
		'<div class="row" style="margin-top:14px">',
		'<div class="col-md-4"><div class="otc-panel">',
		'<h5>Connections</h5>',
		'<div id="otcConnStatus" class="otc-conn-status">',
		'<div class="otc-conn-row"><span class="otc-conn-label">ROD Core RPC</span><span id="otcRpcStatus" class="otc-conn-val text-muted">—</span></div>',
		'<div class="otc-conn-row"><span class="otc-conn-label">Nostr relays</span><span id="otcRelayStatus" class="otc-conn-val text-muted">—</span></div>',
		'</div>',
		'<p style="margin:8px 0 0;font-size:11px;color:#9ec7db">Optional local helper: run <code>tools/rod-rpc-cors-proxy.exe</code>, then point RPC at port 18080. Nostr connects in-page.</p>',
		'</div></div>',
		'<div class="col-md-8"><div class="otc-panel"><h5>Active swaps</h5>',
		'<div class="input-group input-group-sm" style="margin-bottom:8px">',
		'<input id="otcTrackSwapId" class="form-control" placeholder="Paste Swap ID to track incoming negotiation">',
		'<span class="input-group-btn"><button class="btn btn-default" type="button" id="otcTrackSwapBtn">Add by Swap ID</button></span>',
		'</div>',
		'<div id="otcTrackSwapStatus" class="text-muted" style="font-size:11px;margin-bottom:8px"></div>',
		'<div id="otcSwapList"></div></div></div>',
		'</div>',
		'<div class="otc-panel" style="margin-top:12px"><h5>Event log</h5><div id="otcLog" style="max-height:160px;overflow-y:auto;font-size:11px;font-family:monospace"></div></div>',
		'</div>',

		/* ============ NEW SWAP ============ */
		'<div class="tab-pane" id="otcNew">',
		'<div class="otc-panel">',
		'<h4>Create swap / order</h4>',
		'<p class="text-muted" style="font-size:12px;margin-top:0">Post an open <b>order</b> with your terms only, or <b>start a swap</b> after filling counterparty (or by taking an order on the Dashboard).</p>',
		'<div class="row"><div class="col-md-6">',
		'<label>Your role</label><select id="nsRole" class="form-control"><option value="alice">I sell ROD for LTC</option><option value="bob">I buy ROD with LTC</option></select>',
		'<label>ROD amount</label><input id="nsRod" class="form-control" value="1000.00000000">',
		'<label>LTC amount</label><input id="nsLtc" class="form-control" value="5.00000000">',
		'<label>Release ROD height <small id="nsHeightHint" class="text-muted"></small></label><input id="nsRelease" class="form-control" value="">',
		'<label>ROD name for order <small class="text-muted">(written on Create order via name_register / name_update)</small></label>',
		'<div class="input-group">',
		'<input id="nsOrderName" class="form-control" placeholder="d/otc-swap/…" value="' + esc(localStorage.getItem('otcLastOrderName') || '') + '">',
		'<span class="input-group-btn"><button class="btn btn-default" type="button" id="nsOrderNameGen" title="Generate name">Random</button></span>',
		'</div>',
		'<hr style="border-color:rgba(126,233,255,0.15)">',
		'<label>Counterparty identity <small class="text-muted">(required to start a swap — leave empty to post an order)</small></label>',
		'<input id="nsPeer" class="form-control" placeholder="bob.rod or address" autocomplete="off" value="">',
		'<label>Counterparty swap xpub <small class="text-muted">(only auto-filled when you Take an order on Dashboard)</small></label>',
		'<input id="nsPeerXpub" class="form-control" placeholder="xpub… / Ltub…" autocomplete="off" value="">',
		'<label>Counterparty payout address <small class="text-muted">(buyer ROD address when you sell, seller LTC address when you buy)</small></label>',
		'<input id="nsPeerPayoutAddr" class="form-control" placeholder="Counterparty settlement address" autocomplete="off" value="">',
		'<div style="margin-top:14px">',
		'<button class="btn btn-default" id="nsCreateOrder" type="button">Create order</button> ',
		'<button class="btn btn-primary" id="nsCreate" type="button">Create &amp; start swap</button>',
		'</div>',
		'<p id="nsModeHint" class="text-muted" style="font-size:11px;margin-top:8px"></p>',
		'<p id="nsPublishStatus" class="text-muted" style="font-size:11px;margin-top:4px"></p>',
		'</div><div class="col-md-6">',
		'<label>Your identity</label><input id="nsMyAddr" class="form-control" readonly>',
		'<label>Your swap xpub</label><input id="nsMyXpub" class="form-control" readonly>',
		'<label>Swap ID</label><input id="nsSwapId" class="form-control" readonly>',
		'<label>Offer JSON</label><textarea id="nsOffer" class="form-control otc-textarea" readonly style="min-height:140px"></textarea>',
		'</div></div></div></div>',

		/* ============ ACTIVE SWAP ============ */
		'<div class="tab-pane" id="otcActive">',
		'<div class="otc-panel" id="otcActivePanel">',
		'<h4>Active swap detail</h4>',
		'<div id="otcActiveNone" class="text-muted">Select a swap from the Dashboard.</div>',
		'<div id="otcActiveDetail" style="display:none">',
		'<div class="row">',
		'<div class="col-md-6">',
		'<table class="table table-condensed" style="font-size:12px"><tbody id="otcAInfo"></tbody></table>',
		'</div>',
		'<div class="col-md-6">',
		'<h5>Timeline</h5><div id="otcATimeline" style="max-height:200px;overflow-y:auto;font-size:11px"></div>',
		'</div>',
		'</div>',
		'<h5>Execution log</h5>',
		'<div id="otcALog" class="otc-swap-log" style="max-height:250px"></div>',
		'<div id="otcExecution" class="otc-panel" style="margin-top:12px">',
		'<h5>Real swap execution</h5>',
		'<div class="alert alert-info" style="font-size:12px;margin-bottom:8px"><b>Safety:</b> funding is broadcast only after BOTH pre-signed timelocked refunds and BOTH verified adaptor signatures are in place (PREPARED). If the counterparty disappears, the automation broadcasts your refund once its lock height passes.</div>',
		'<div id="otcExecStatus" style="font-size:12px;margin-top:8px"></div>',
		'<div class="btn-toolbar" style="margin-top:10px">',
		'<button class="btn btn-primary btn-sm otcExecBtn" data-action="accept-offer">Accept swap</button> ',
		'<button class="btn btn-success btn-sm otcExecBtn" data-action="claim-ltc">Accept: claim LTC</button> ',
		'<button class="btn btn-success btn-sm otcExecBtn" data-action="claim-rod">Accept: claim ROD</button> ',
		'<button class="btn btn-warning btn-sm otcExecBtn" data-action="attempt-refund">Attempt refund</button> ',
		'<button class="btn btn-default btn-sm otcExecBtn" data-action="refresh">Refresh confirmations</button>',
		'</div>',
		'</div>',
		'</div>',
		'</div></div>',

		/* ============ HISTORY ============ */
		'<div class="tab-pane" id="otcHist">',
		'<div class="otc-panel"><h4>Trade history</h4><table class="table table-striped otc-session-table"><thead><tr><th>Date</th><th>ID</th><th>Role</th><th>ROD</th><th>LTC</th><th>State</th></tr></thead><tbody id="otcHistBody"></tbody></table><button class="btn btn-default btn-xs" id="otcClearHist">Clear</button></div></div>',

		/* ============ SETTINGS ============ */
		'<div class="tab-pane" id="otcCfg">',
		'<div class="row"><div class="col-md-6"><div class="otc-panel">',
		'<h4>API servers</h4>',
		'<label>ROD API</label><input id="cfgRodApi" class="form-control" value="' + esc(cfg.rodApiUrl) + '">',
		'<label>LTC API</label><input id="cfgLtcApi" class="form-control" value="' + esc(cfg.ltcApiUrl) + '">',
		'<h4 style="margin-top:14px">Nostr relays</h4>',
		'<textarea id="cfgRelays" class="form-control" rows="3">' + esc((cfg.relays || ENGINE.DEFAULT_RELAYS).join('\n')) + '</textarea>',
		'<button class="btn btn-primary btn-sm" id="cfgSaveApi" style="margin-top:10px">Save API & Relay settings</button>',
		'</div></div>',
		'<div class="col-md-6"><div class="otc-panel">',
		'<h4>ROD Core RPC <small>(optional local helper)</small></h4>',
		'<p style="color:#9ec7db;font-size:11px">Raw Core has no CORS. Run <code>tools\\rod-rpc-cors-proxy.exe</code>, then point here at the <b>proxy</b> (port <b>18080</b>), not Core 11999. Leave blank for pure offline use.</p>',
		'<pre style="font-size:11px;background:rgba(0,0,0,0.25);padding:8px;border-radius:6px;white-space:pre-wrap">tools\\rod-rpc-cors-proxy.exe\nhttp://USER:PASS@127.0.0.1:18080/wallet/ROD</pre>',
		'<label>URL <small class="text-muted">(host or full URL)</small></label><input id="cfgRpcUrl" class="form-control" value="' + esc(cfg.rpcUrl) + '" placeholder="http://USER:PASS@127.0.0.1:18080/wallet/ROD">',
		'<label>Port <small class="text-muted">(ignored if URL has port)</small></label><input id="cfgRpcPort" class="form-control" value="' + esc(cfg.rpcPort || '18080') + '">',
		'<label>User</label><input id="cfgRpcUser" class="form-control" value="' + esc(cfg.rpcUser) + '">',
		'<label>Password</label><input id="cfgRpcPass" class="form-control" type="password" value="' + esc(cfg.rpcPass) + '">',
		'<label>Wallet <small class="text-muted">(e.g. ROD → /wallet/ROD)</small></label><input id="cfgRpcWallet" class="form-control" value="' + esc(cfg.rpcWallet) + '" placeholder="ROD">',
		'<button class="btn btn-primary btn-sm" id="cfgSaveRpc" style="margin-top:10px">Save RPC settings</button>',
		'<p id="cfgRpcEndpointHint" style="margin-top:8px;font-size:11px;color:#9ec7db"></p>',
		'</div></div></div>',
		'<div class="row" style="margin-top:14px"><div class="col-md-6"><div class="otc-panel">',
		'<h4>Validation</h4><button class="btn btn-default btn-sm" id="cfgRunTests">Run test suite</button> <span id="cfgTestR"></span>',
		'</div></div>',
		'<div class="col-md-6"><div class="otc-panel">',
		'<h4>Backup / restore</h4>',
		'<button class="btn btn-default btn-xs" id="cfgExport">Export</button> <button class="btn btn-default btn-xs" id="cfgImport">Import</button>',
		'<textarea id="cfgBackup" class="form-control otc-textarea" style="margin-top:6px"></textarea>',
		'</div></div></div>',
		'</div>',

		'</div>',
		'<style>',
		'.otc-nav{margin-bottom:0;border-bottom:1px solid rgba(126,233,255,0.15)}',
		'.otc-nav>li>a{color:#9ec7db;border-radius:10px 10px 0 0;padding:8px 14px;font-size:13px}',
		'.otc-nav>li.active>a,.otc-nav>li.active>a:hover,.otc-nav>li.active>a:focus{background:rgba(9,199,247,0.12);color:#fff;border:1px solid rgba(126,233,255,0.25);border-bottom-color:transparent}',
		'.otc-nav>li>a:hover{background:rgba(255,255,255,0.04);color:#fff}',
		'.otc-book-tbl{margin-bottom:0}.otc-book-tbl td,.otc-book-tbl th{padding:4px 6px!important;font-size:11px}',
		'.otc-book-tbl tr.otc-price-row{cursor:pointer}.otc-book-tbl tr.otc-price-row:hover{background:rgba(255,255,255,0.07)}',
		'.otc-book-tbl tr.otc-price-row.active{background:rgba(9,199,247,0.18)}',
		'.otc-swap-card{padding:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(126,233,255,0.12);border-radius:10px;margin-bottom:8px;cursor:pointer}',
		'.otc-swap-card:hover{border-color:rgba(126,233,255,0.35)}',
		'.otc-swap-log{max-height:200px;overflow-y:auto;font-size:11px;font-family:monospace;padding:8px;background:rgba(0,0,0,0.2);border-radius:8px}',
		'.otc-conn-status{font-size:12px}',
		'.otc-conn-row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid rgba(126,233,255,0.08)}',
		'.otc-conn-row:last-child{border-bottom:0}',
		'.otc-conn-label{color:#9ec7db;font-weight:600}',
		'.otc-conn-val{text-align:right}',
		'.otc-conn-ok{color:#62e6a6}',
		'.otc-conn-bad{color:#f1334a}',
		'.otc-conn-warn{color:#f0ad4e}',
		'</style>'
	].join('\n'));

	/* ============ Helpers ============ */
	function flash(t, m) { $('#otcFlash').removeClass('hidden alert-success alert-danger alert-warning alert-info').addClass('alert-' + t).text(m); }
	var EVENT_LOG_LIMIT = 200;
	function log(m) {
		var $log = $('#otcLog');
		$log.prepend('<div>[' + ts() + '] ' + esc(m) + '</div>');
		var $entries = $log.children();
		if ($entries.length > EVENT_LOG_LIMIT) {
			$entries.slice(EVENT_LOG_LIMIT).remove();
		}
	}
	var walletId = null, swapAcct = null;
	function checkWallet() {
		walletId = ENGINE.getWalletIdentity();
		if (!walletId) { $('#otcWarn').show(); $('#otcWalletOk').hide(); swapAcct = null; return false; }
		$('#otcWarn').hide();
		try {
			/* master() returns {privkey:xprv, pubkey:xpub} — not keys_extended */
			var hd = ENGINE.deriveSwapAccount(walletId.wif);
			var xprv = hd && (hd.privkey || (hd.keys_extended && hd.keys_extended.privkey)) || '';
			var xpub = hd && (hd.pubkey || (hd.keys_extended && hd.keys_extended.pubkey)) || '';
			if (!xprv || !xpub) throw new Error('Could not derive swap account from wallet');
			swapAcct = { xprv: xprv, xpub: xpub };
			var npub = '';
			try {
				if (NOSTR && NOSTR.identityFromWif) {
					var nostrIdentity = NOSTR.identityFromWif(walletId.wif);
					npub = nostrIdentity.npub || '';
					walletId.nostrPrivateKey = nostrIdentity.privateKeyHex || '';
				}
			} catch (npubErr) { npub = ''; }
			walletId.npub = npub;
			var okHtml = 'Wallet: <code>' + esc(walletId.address) + '</code>';
			if (npub) {
				okHtml += ' &nbsp;·&nbsp; Nostr: <code title="' + esc(npub) + '">' + esc(npub) + '</code>';
			}
			$('#otcWalletOk').html(okHtml).show();
			$('#nsMyAddr').val(walletId.address);
			$('#nsMyXpub').val(swapAcct.xpub);
			return true;
		} catch (e) {
			swapAcct = null;
			$('#otcWarn').show();
			$('#otcWalletOk').hide();
			return false;
		}
	}
	$('a[data-toggle="tab"][href="#otc"]').on('shown.bs.tab', checkWallet);
	setInterval(function () { if ($('#otc').is(':visible')) checkWallet(); }, 5000);
	checkWallet();

	/* ============ ORDERBOOK ============ */
	var allOffers = [], currentRodHeight = 0;
	function orderCreatedAt(order) {
		var orderId = String(order && order.orderId || '');
		var match = orderId.match(/(\d{13})$/);
		if (!match) return '';
		var createdAt = new Date(parseInt(match[1], 10));
		return isNaN(createdAt.getTime()) ? '' : createdAt.toLocaleString();
	}
	function isOrderExpired(order, chainHeight) {
		var dueBlock = parseInt(order && order.releaseRodHeight, 10);
		return !!(dueBlock && chainHeight && dueBlock <= chainHeight);
	}
	function refreshBook() {
		$('#otcBookTime').text('Scanning ROD DB…');
		$('#otcScanReport').html('<span class="text-muted">name_scan regexp <code>^d/otc-swap/</code> …</span>');
		$.when(ENGINE.scanOtcOrdersFromDb({ regexp: ENGINE.OTC_NAME_REGEXP || '^d/otc-swap/' }), ENGINE.getRodHeight()).then(function (result, height) {
			var scanResult = result && result.offers ? result : (coinjs.isArray(result) ? result[0] : result);
			var chainHeight = parseInt(height, 10) || 0;
			var offers = (scanResult && scanResult.offers) ? scanResult.offers : [];
			var reports = (scanResult && scanResult.reports) ? scanResult.reports : [];
			var activeOffers = [];
			var expiredCount = 0;
			currentRodHeight = chainHeight;
			offers.forEach(function (offer) {
				offer._createdAt = orderCreatedAt(offer);
				offer._dueBlock = parseInt(offer.releaseRodHeight, 10) || 0;
				offer._isExpired = isOrderExpired(offer, chainHeight);
				if (offer._isExpired) {
					expiredCount++;
					return;
				}
				activeOffers.push(offer);
			});
			allOffers = activeOffers;
			/* Group by price for ask/bid */
			var asks = {}, bids = {};
			activeOffers.forEach(function (o) {
				var rod = parseFloat(o.give || o.rodAmount || 0), ltc = parseFloat(o.want || o.ltcAmount || 0);
				if (rod <= 0 || ltc <= 0) return;
				var price = (ltc / rod).toFixed(8);
				var side = (o.side === 'buy') ? bids : asks;
				if (!side[price]) side[price] = { vol: 0, offers: [] };
				side[price].vol += rod;
				side[price].offers.push(o);
			});
			renderBookSide('#otcAsks', asks, 'ask');
			renderBookSide('#otcBids', bids, 'bid');
			/* Mid price */
			var askPrices = Object.keys(asks).map(Number).sort();
			var bidPrices = Object.keys(bids).map(Number).sort().reverse();
			var mid = '—';
			if (askPrices.length && bidPrices.length) mid = ((askPrices[0] + bidPrices[0]) / 2).toFixed(8);
			else if (askPrices.length) mid = askPrices[0].toFixed(8);
			else if (bidPrices.length) mid = bidPrices[0].toFixed(8);
			$('#otcMidPrice').text(mid);
			var scanned = (scanResult && scanResult.scanned != null) ? scanResult.scanned : reports.length;
			$('#otcBookTime').text(activeOffers.length + ' active offers · ' + expiredCount + ' expired filtered · h' + chainHeight + ' · ' + ts());
			$('#otcBookDetail').hide();
			if (reports.length) {
				var visibleReports = reports.filter(function (report) {
					return !report.ok;
				});
				$('#otcScanReport').html(
					'<div class="text-muted" style="margin-bottom:4px">regexp <code>^d/otc-swap/</code> · ' + scanned + ' name(s) · current block <code>' + esc(chainHeight) + '</code> · expired filtered <code>' + esc(expiredCount) + '</code></div>' +
					(visibleReports.length
						? visibleReports.map(function (report) {
							return '<div style="color:#f0ad4e"><b>' + esc(report.name) + '</b> — ' + esc(report.detail) + '</div>';
						}).join('')
						: '<div class="text-muted">Active orders loaded. Hidden successful raw scan rows to reduce clutter.</div>')
				);
			} else {
				$('#otcScanReport').html('<span class="text-muted">No names matched <code>^d/otc-swap/</code></span>');
			}
		}, function (scanError) {
			var msg = (scanError && scanError.message) ? scanError.message : (typeof scanError === 'string' ? scanError : 'Scan failed');
			$('#otcBookTime').text('Failed · ' + ts());
			$('#otcScanReport').html('<span style="color:#f1334a">' + esc(msg) + ' — is ROD Core RPC / proxy connected?</span>');
			$('#otcAsks,#otcBids').html('<tr><td colspan="3" class="text-muted" style="font-size:11px">Scan failed</td></tr>');
		});
	}
	function renderBookSide(sel, grouped, side) {
		var prices = Object.keys(grouped).map(Number).sort(side === 'ask' ? function (a, b) { return a - b; } : function (a, b) { return b - a; });
		var cumul = 0, rows = [];
		prices.forEach(function (p) {
			var g = grouped[p.toFixed(8)]; cumul += g.vol;
			rows.push('<tr class="otc-price-row" data-price="' + p.toFixed(8) + '" data-side="' + side + '"><td>' + p.toFixed(8) + '</td><td>' + g.vol.toFixed(2) + '</td><td>' + cumul.toFixed(2) + '</td></tr>');
		});
		$(sel).html(rows.join('') || '<tr><td colspan="3" class="text-muted" style="font-size:11px">No ' + side + 's</td></tr>');
	}
	$('#otcRefreshBook').on('click', refreshBook);
	/* Auto-load orderbook when OTC tab is opened */
	$('a[data-toggle="tab"][href="#otc"]').on('shown.bs.tab', function () {
		refreshBook();
	});
	/* Also refresh when Dashboard sub-tab is shown */
	$(document).on('shown.bs.tab', 'a[href="#otcDash"]', function () {
		refreshBook();
	});
	setTimeout(function () {
		if ($('#otc').hasClass('active') || $('#otcDash').hasClass('active')) refreshBook();
	}, 800);

	/* Click price row → show offers at that price */
	$(document).on('click', '.otc-price-row', function () {
		$('.otc-price-row').removeClass('active'); $(this).addClass('active');
		var price = $(this).data('price'), side = $(this).data('side');
		var matching = allOffers.filter(function (o) {
			var rod = parseFloat(o.give || o.rodAmount || 0), ltc = parseFloat(o.want || o.ltcAmount || 0);
			return rod > 0 && ltc > 0 && (ltc / rod).toFixed(8) === price;
		});
		$('#otcBookDetailTitle').text((side === 'ask' ? 'Sell' : 'Buy') + ' offers at ' + price + ' LTC/ROD');
		$('#otcBookDetailBody').html(matching.map(function (o) {
			var createdAt = o._createdAt ? '<div class="text-muted" style="font-size:10px">Created ' + esc(o._createdAt) + '</div>' : '';
			var dueBlock = o._dueBlock ? '<div class="text-muted" style="font-size:10px">Due block ' + esc(o._dueBlock) + (currentRodHeight ? ' · ' + esc(o._dueBlock - currentRodHeight) + ' left' : '') + '</div>' : '';
			return '<tr><td>' + esc(o.seller || o._name || '—') + createdAt + dueBlock + '</td><td>' + esc(o.give || o.rodAmount) + '</td><td>' + esc(o.want || o.ltcAmount) + '</td>' +
				'<td><code style="font-size:10px">' + esc(short(o.sellerSwapXpub || o.buyerSwapXpub || '')) + '</code></td>' +
				'<td><button class="btn btn-xs btn-primary otcTakeOffer" data-rod="' + esc(o.give || o.rodAmount) + '" data-ltc="' + esc(o.want || o.ltcAmount) + '" data-peer="' + esc(o.seller || o._name) + '" data-xpub="' + esc(o.sellerSwapXpub || o.buyerSwapXpub || '') + '" data-release="' + esc(o.releaseRodHeight || '') + '" data-side="' + esc(side) + '">Take</button></td></tr>';
		}).join(''));
		$('#otcBookDetail').show();
	});

	/* Take offer → go to New swap and fill counterparty from the chosen order only */
	var nsPrefillFromOrder = false;
	$(document).on('click', '.otcTakeOffer', function () {
		var $b = $(this);
		nsPrefillFromOrder = true;
		$('#nsRod').val($b.data('rod'));
		$('#nsLtc').val($b.data('ltc'));
		$('#nsPeer').val($b.data('peer') || '');
		$('#nsPeerXpub').val($b.data('xpub') || '');
		$('#nsPeerPayoutAddr').val($b.data('side') === 'bid' ? ($b.data('buyerRodPayout') || '') : ($b.data('sellerLtcPayout') || ''));
		if ($b.data('release')) $('#nsRelease').val($b.data('release'));
		/* Taking an ask (sell) → you are buyer (bob); taking a bid → you are seller (alice) */
		$('#nsRole').val($b.data('side') === 'bid' ? 'alice' : 'bob');
		updateNsModeHint();
		$('#otcNav a[href="#otcNew"]').tab('show');
		flash('info', 'Order loaded from Dashboard — counterparty filled. Review and click Create & start swap.');
	});

	/* ============ CONNECTIONS (RPC + Nostr) ============ */
	function setConnVal(sel, cls, text) {
		$(sel).removeClass('text-muted otc-conn-ok otc-conn-bad otc-conn-warn').addClass(cls).text(text);
	}
	function refreshRelayStatus() {
		if (!ENGINE.pool) {
			setConnVal('#otcRelayStatus', 'text-muted', 'Not started');
			return;
		}
		var n = ENGINE.pool.count();
		var total = ENGINE.pool.total();
		if (n > 0) setConnVal('#otcRelayStatus', 'otc-conn-ok', n + ' / ' + total + ' connected');
		else setConnVal('#otcRelayStatus', 'otc-conn-warn', 'Connecting… (0 / ' + total + ')');
	}
	function refreshRpcStatus() {
		ENGINE.checkRpcStatus().then(function (st) {
			if (!st.configured) setConnVal('#otcRpcStatus', 'text-muted', 'Not configured');
			else if (st.online) setConnVal('#otcRpcStatus', 'otc-conn-ok', 'Connected' + (st.height != null ? ' · h' + st.height : ''));
			else setConnVal('#otcRpcStatus', 'otc-conn-bad', st.message || 'Offline');
		});
	}
	function updateRpcEndpointHint() {
		var draft = {
			rpcUrl: $.trim($('#cfgRpcUrl').val()),
			rpcPort: $.trim($('#cfgRpcPort').val()) || '11999',
			rpcUser: $.trim($('#cfgRpcUser').val()),
			rpcPass: $('#cfgRpcPass').val(),
			rpcWallet: $.trim($('#cfgRpcWallet').val())
		};
		var ep = draft.rpcUrl ? ENGINE.buildRpcEndpoint(draft) : null;
		if (!ep) {
			$('#cfgRpcEndpointHint').text('Resolved endpoint: (not set)');
			return;
		}
		$('#cfgRpcEndpointHint').text('Resolved endpoint: ' + ep.url + (ep.user ? '  ·  auth as ' + ep.user : '  ·  no auth'));
	}
	$('#cfgRpcUrl,#cfgRpcPort,#cfgRpcUser,#cfgRpcPass,#cfgRpcWallet').on('input change', updateRpcEndpointHint);
	updateRpcEndpointHint();
	function refreshConnStatus() {
		refreshRelayStatus();
		refreshRpcStatus();
	}
	function startNostr(restart) {
		if (restart) {
			ENGINE.restartRelays();
		} else {
			ENGINE.startRelays();
		}
		if (ENGINE.pool) {
			ENGINE.pool.onStatus = function (t, u) {
				log((t === '+' ? 'relay up' : 'relay down') + ' ' + u);
				refreshRelayStatus();
			};
			ENGINE.pool.onNotice = function (message, relayUrl) {
				var kind = message && message[0] ? message[0] : 'RELAY';
				var detail = '';
				if (kind === 'OK') detail = (message[2] ? 'accepted' : 'rejected') + ' ' + short(message[1]) + (message[3] ? ' · ' + message[3] : '');
				else if (kind === 'LOCAL_FLUSH') detail = 'replayed ' + message[1] + ' queued OTC event(s)';
				else detail = message && message.length > 1 ? message.slice(1).join(' · ') : '';
				log(kind + ' ' + relayUrl + (detail ? ' · ' + detail : ''));
			};
		}
		ENGINE.onRelayPublish = function (eventObject, relayCount) {
			var envelope = {};
			try { envelope = JSON.parse(eventObject.content || '{}'); } catch (error) {}
			log('→ ' + (envelope.type || 'event') + ' ' + short(envelope.swapId || '') + ' kind ' + eventObject.kind + ' id ' + short(eventObject.id || '') + ' sig=' + (!!eventObject.sig) + ' sent to ' + relayCount + ' relay(s)');
			if (!relayCount) flash('warning', 'Nostr publish had 0 connected relays; counterparty cannot discover this swap yet.');
		};
		ENGINE.onRelaySubscription = function (subId, filter, label) {
			log('sub ' + label + ' ' + subId + ' ' + JSON.stringify(filter));
		};
		ENGINE.onRelayEventDebug = function (message) {
			log('debug ' + message);
		};
		ENGINE.startListening(!!restart);
		ENGINE.onSwapMessage = function (env, eventObject) {
			if (!shouldProcessRelayEvent(env)) return;
			log('← ' + env.type + ' ' + short(env.swapId));
			autoProcess(env, eventObject);
			refreshSwaps();
		};
		refreshRelayStatus();
		setTimeout(refreshRelayStatus, 1500);
		setTimeout(refreshRelayStatus, 4000);
	}

	/* ============ DASHBOARD SWAP LIST ============ */
	function refreshSwaps() {
		var all = ENGINE.loadLive(), ids = Object.keys(all);
		if (!ids.length) { $('#otcSwapList').html('<div class="text-muted" style="font-size:12px">No active swaps.</div>'); return; }
		$('#otcSwapList').html(ids.map(function (id) {
			var s = all[id], cls = s.state === 'COMPLETE' ? 'success' : 'info';
			return '<div class="otc-swap-card" data-id="' + esc(id) + '">' +
				'<span class="label label-' + cls + '">' + esc(s.state) + '</span> ' +
				'<code>' + esc(short(id)) + '</code> · ' + esc(s.role === 'alice' ? 'Seller' : 'Buyer') +
				' · ' + esc(s.terms.rodAmount) + ' ROD / ' + esc(s.terms.ltcAmount) + ' LTC' +
				' <button class="btn btn-xs btn-default otcRmSwap pull-right" data-id="' + esc(id) + '">×</button></div>';
		}).join(''));
	}
	$(document).on('click', '.otc-swap-card', function (e) {
		if ($(e.target).hasClass('otcRmSwap')) return;
		showActiveSwap($(this).data('id'));
	});
	$(document).on('click', '.otcRmSwap', function (e) {
		e.stopPropagation(); ENGINE.removeLive($(this).data('id')); refreshSwaps();
	});
	$('#otcTrackSwapBtn').on('click', function () {
		var swapId = $.trim($('#otcTrackSwapId').val()).toLowerCase();
		try {
			if (!checkWallet()) throw new Error('Open your wallet before tracking a swap');
			if (ENGINE.trackSwapId) ENGINE.trackSwapId(swapId);
			$('#otcTrackSwapStatus').html('Tracking <code>' + esc(short(swapId)) + '</code> — waiting for matching Nostr events.');
			flash('info', 'Tracking swap ' + short(swapId) + '. Keep this tab open until terms arrive.');
			log('Tracking swap ID ' + swapId);
		} catch (error) {
			$('#otcTrackSwapStatus').html('<span style="color:#f1334a">' + esc(error.message || error) + '</span>');
			flash('warning', error.message || String(error));
		}
	});

	/* ============ ACTIVE SWAP DETAIL (read-only) ============ */
	function showActiveSwap(id) {
		var s = ENGINE.restoreLive(id);
		if (!s) { flash('warning', 'Session not found'); return; }
		$('#otcActiveTab').tab('show');
		$('#otcActiveNone').hide(); $('#otcActiveDetail').show();
		var readiness = s.readiness || {};
		var execution = s.execution || {};
		var rows = [
			['Swap ID', '<code>' + esc(s.swapId) + '</code>'],
			['State', '<span class="label label-info">' + esc(s.state) + '</span>'],
			['Role', esc(s.role === 'alice' ? 'Seller (Alice)' : 'Buyer (Bob)')],
			['Decision', decisionSummary(s)],
			['ROD amount', esc(s.terms.rodAmount)],
			['LTC amount', esc(s.terms.ltcAmount)],
			['Rate', esc(rate(s.terms.rodAmount, s.terms.ltcAmount)) + ' LTC/ROD'],
			['Bilateral ready', s.bilateralReady ? '<span class="label label-success">yes</span>' : '<span class="label label-default">no</span>'],
			['Local readiness', readinessSummary(readiness.local)],
			['Remote readiness', readinessSummary(readiness.remote)],
			['Release height', esc(s.terms.releaseRodHeight)],
			['ROD refund height', esc(s.terms.refundRodHeight || '—') + (s.rodRefund && s.rodRefund.signedHex ? ' · <span class="label label-success">refund signed</span>' : ' · <span class="label label-default">refund pending</span>')],
			['LTC refund height', esc(s.terms.ltcRefundLockHeight || '—') + (s.ltcRefund && s.ltcRefund.signedHex ? ' · <span class="label label-success">refund signed</span>' : ' · <span class="label label-default">refund pending</span>')],
			['Planned ROD funding', s.plannedRodFunding ? '<code style="font-size:10px">' + esc(short(s.plannedRodFunding.txid)) + '</code>' : '<span class="text-muted">not planned</span>'],
			['Planned LTC funding', s.plannedLtcFunding ? '<code style="font-size:10px">' + esc(short(s.plannedLtcFunding.txid)) + '</code>' : '<span class="text-muted">not planned</span>'],
			['Prepared', (s.localPrepared ? '<span class="label label-success">local</span>' : '<span class="label label-default">local pending</span>') + ' ' + (s.remotePrepared ? '<span class="label label-success">remote</span>' : '<span class="label label-default">remote pending</span>')],
			['Adaptor sigs', (s.localLtcAdaptorSignature || s.localRodAdaptorSignature ? '<span class="label label-success">local sent</span>' : '<span class="label label-default">local pending</span>') + ' ' + (s.remoteLtcAdaptorSignature || s.remoteRodAdaptorSignature ? '<span class="label label-success">remote verified</span>' : '<span class="label label-default">remote pending</span>')],
			['Terms hash', '<code style="font-size:10px">' + esc(s.terms.termsHash) + '</code>'],
			['Child index', esc(s.childIndex)],
			['ROD multisig', '<code style="font-size:10px">' + esc(s.terms.rodFunding.multisigAddress) + '</code>'],
			['LTC multisig', '<code style="font-size:10px">' + esc(s.terms.ltcFunding.multisigAddress) + '</code>'],
			['ROD funding tx', txSummary(execution.rodFunding)],
			['LTC funding tx', txSummary(execution.ltcFunding)],
			['LTC claim tx', txSummary(execution.ltcClaim)],
			['ROD claim tx', txSummary(execution.rodClaim)],
			['Redeem (ROD)', '<code style="font-size:9px;word-break:break-all">' + esc(s.terms.rodFunding.redeemScript) + '</code>'],
			['Redeem (LTC)', '<code style="font-size:9px;word-break:break-all">' + esc(s.terms.ltcFunding.redeemScript) + '</code>'],
			['Adaptor point', s.adaptorPoint ? '<code style="font-size:10px">' + esc(s.adaptorPoint) + '</code>' : '<span class="text-muted">not yet</span>'],
			['Alice pubkey', '<code style="font-size:10px">' + esc(s.terms.aliceChildPubKey) + '</code>'],
			['Bob pubkey', '<code style="font-size:10px">' + esc(s.terms.bobChildPubKey) + '</code>'],
			['Seller xpub', '<code style="font-size:10px">' + esc(short(s.sellerSwapXpub)) + '</code>'],
			['Buyer xpub', '<code style="font-size:10px">' + esc(short(s.buyerSwapXpub)) + '</code>'],
			['Messages', (s.messages || []).length + ' events']
		];
		$('#otcAInfo').html(rows.map(function (r) { return '<tr><td style="width:120px;color:#9ec7db;font-weight:600">' + r[0] + '</td><td>' + r[1] + '</td></tr>'; }).join(''));
		renderExecutionButtons(s);
		/* Timeline */
		$('#otcATimeline').html((s.timeline || []).map(function (t) {
			return '<div style="margin-bottom:4px"><span class="label label-default" style="font-size:10px">' + esc(t.state) + '</span> <small>' + esc(t.at) + '</small> <small class="text-muted">' + esc(t.note || '') + '</small></div>';
		}).join(''));
		/* Execution log */
		var logs = (s._log || []);
		$('#otcALog').html(logs.map(function (l) { return '<div>' + esc(l) + '</div>'; }).join('') || '<div class="text-muted">No events yet.</div>');
		$('#otcExecStatus').html(executionStatusHtml(s));
	}

	function txSummary(evidence) {
		if (!evidence || !evidence.txid) return '<span class="text-muted">not set</span>';
		return '<code style="font-size:10px">' + esc(short(evidence.txid)) + '</code>' + (evidence.confirmations != null ? ' · conf ' + esc(evidence.confirmations) : '');
	}

	function decisionSummary(session) {
		if (session.declined) return '<span class="label label-danger">declined</span>';
		var local = session.localAccepted ? '<span class="label label-success">local accepted</span>' : '<span class="label label-default">local pending</span>';
		var remote = session.remoteAccepted ? '<span class="label label-success">remote accepted</span>' : '<span class="label label-default">remote pending</span>';
		return local + ' ' + remote;
	}

	function renderExecutionButtons(session) {
		$('.otcExecBtn').hide().prop('disabled', false);
		$('.otcExecBtn[data-action="refresh"]').show();
		var execution = session.execution || {};
		if (!session.declined && !session.localAccepted && session.state !== 'COMPLETE') {
			$('.otcExecBtn[data-action="accept-offer"]').show();
		}
		if (session.role === 'alice' && session.localAccepted && session.state !== 'COMPLETE' && !(execution.ltcClaim && execution.ltcClaim.txid)) {
			$('.otcExecBtn[data-action="claim-ltc"]').show().prop('disabled', !ltcClaimReady(session));
		}
		if (session.role === 'bob' && session.localAccepted && session.state !== 'COMPLETE' && !(execution.rodClaim && execution.rodClaim.txid)) {
			$('.otcExecBtn[data-action="claim-rod"]').show().prop('disabled', !rodClaimReady(session));
		}
		var ownRefund = session.role === 'alice' ? session.rodRefund : session.ltcRefund;
		var ownFunding = session.role === 'alice' ? execution.rodFunding : execution.ltcFunding;
		if (ownRefund && ownRefund.signedHex && ownFunding && ownFunding.txid && session.state !== 'COMPLETE') {
			$('.otcExecBtn[data-action="attempt-refund"]').show();
		}
	}

	function executionStatusHtml(session) {
		var e = session.execution || {};
		return [
			'<div><b>ROD funding:</b> ' + txSummary(e.rodFunding) + '</div>',
			'<div><b>LTC funding:</b> ' + txSummary(e.ltcFunding) + '</div>',
			'<div><b>LTC claim:</b> ' + txSummary(e.ltcClaim) + '</div>',
			'<div><b>ROD claim:</b> ' + txSummary(e.rodClaim) + '</div>'
		].join('');
	}

	function fundingFee(chainCode) {
		return chainCode === 'ROD' ? '0.00051900' : '0.00001000';
	}

	/* Settlement fees come from canonical terms so both sides construct
	   byte-identical claim/refund transactions (diverging fees would diverge
	   the sighashes and invalidate every exchanged signature). */
	function claimFee(session, chainCode) {
		var terms = session && session.terms || {};
		if (chainCode === 'ROD') return terms.rodClaimFee || SWAP.DEFAULT_FEES.rodClaimFee;
		return terms.ltcClaimFee || SWAP.DEFAULT_FEES.ltcClaimFee;
	}

	function refundFee(session, chainCode) {
		var terms = session && session.terms || {};
		if (chainCode === 'ROD') return terms.rodRefundFee || SWAP.DEFAULT_FEES.rodRefundFee;
		return terms.ltcRefundFee || SWAP.DEFAULT_FEES.ltcRefundFee;
	}

	/* Planned (signed, unbroadcast) funding is the single source of truth for
	   every dependent transaction: refunds, adaptor sigs and claims all spend
	   the planned outpoint, and the on-chain funding is later gated to match. */
	function plannedFunding(session, chainCode) {
		return chainCode === 'ROD' ? session.plannedRodFunding : session.plannedLtcFunding;
	}

	function claimTxFor(session, chainCode) {
		var planned = plannedFunding(session, chainCode);
		if (!planned || !planned.txid) throw new Error(chainCode + ' planned funding is missing');
		return ENGINE.buildClaimTxFromFunding(chainCode, planned, fundingTarget(session, chainCode).redeemScript, claimDestination(session, chainCode), claimFee(session, chainCode));
	}

	function refundTxFor(session, chainCode) {
		var planned = plannedFunding(session, chainCode);
		if (!planned || !planned.txid) throw new Error(chainCode + ' planned funding is missing');
		var terms = session.terms;
		var destination = chainCode === 'ROD' ? terms.sellerRodRefundAddress : terms.buyerLtcRefundAddress;
		var lockHeight = chainCode === 'ROD' ? terms.refundRodHeight : terms.ltcRefundLockHeight;
		if (!destination) throw new Error(chainCode + ' refund destination missing from terms');
		if (!lockHeight) throw new Error(chainCode + ' refund lock height missing from terms');
		return ENGINE.buildRefundTxFromFunding(chainCode, planned, fundingTarget(session, chainCode).redeemScript, destination, refundFee(session, chainCode), lockHeight);
	}

	function ltcClaimReady(session) {
		return !!(session.remoteLtcAdaptorSignature && session.adaptorSecret && session.plannedLtcFunding &&
			session.execution && session.execution.ltcFunding && session.execution.ltcFunding.verifiedLocally);
	}

	function rodClaimReady(session) {
		return !!(session.remoteRodAdaptorSignature && session.recoveredAdaptorSecret && session.plannedRodFunding);
	}

	/* ============ NEW SWAP ============ */
	function clearCounterpartyFields() {
		$('#nsPeer').val('');
		$('#nsPeerXpub').val('');
		$('#nsPeerPayoutAddr').val('');
		nsPrefillFromOrder = false;
		updateNsModeHint();
	}

	function updateNsModeHint() {
		var peer = $.trim($('#nsPeer').val());
		var xpub = $.trim($('#nsPeerXpub').val());
		var payoutAddress = $.trim($('#nsPeerPayoutAddr').val());
		if (peer && xpub && payoutAddress) {
			$('#nsModeHint').html(nsPrefillFromOrder
				? 'Mode: <b>start swap</b> (counterparty loaded from Dashboard order).'
				: 'Mode: <b>start swap</b> (counterparty entered manually).');
		} else {
			$('#nsModeHint').html('Mode: <b>create order</b> — counterparty fields incomplete. Use <b>Create order</b>, or Take an order on the Dashboard to fill counterparty and payout details.');
		}
	}
	$('#nsPeer, #nsPeerXpub, #nsPeerPayoutAddr').on('input change', updateNsModeHint);

	function decimalToBaseUnits(value) {
		var text = $.trim(value == null ? '' : String(value));
		if (!/^\d+(\.\d{0,8})?$/.test(text)) return null;
		var parts = text.split('.');
		var whole = parts[0].replace(/^0+(?=\d)/, '') || '0';
		var fraction = (parts[1] || '').slice(0, 8);
		while (fraction.length < 8) fraction += '0';
		return (whole + fraction).replace(/^0+(?=\d)/, '') || '0';
	}

	function isBaseUnitsLessThan(left, right) {
		var a = String(left || '0').replace(/^0+(?=\d)/, '') || '0';
		var b = String(right || '0').replace(/^0+(?=\d)/, '') || '0';
		if (a.length !== b.length) return a.length < b.length;
		return a < b;
	}

	function balanceResponseAmount(response) {
		var row = response && response.data && response.data[0] ? response.data[0] : null;
		return row && row.balance != null ? row.balance : null;
	}

	function getWalletAddressForChain(wif, chainCode) {
		var previousNetworkCode = coinjs.activeNetwork;
		try {
			coinjs.setNetwork(chainCode);
			return coinjs.wif2address(wif).address;
		} finally {
			coinjs.setNetwork(previousNetworkCode || 'ROD');
		}
	}

	function getChainBalance(chainCode, address) {
		var d = $.Deferred();
		var previousNetworkCode = coinjs.activeNetwork;
		try {
			coinjs.setNetwork(chainCode);
			/* addressBalance captures coinjs.getNetwork() synchronously at
			   call time, so the global network can be restored immediately.
			   Restoring inside the async callback left the whole page on LTC
			   for the duration of the request — any concurrent derivation
			   (checkWallet poll) then emitted LTC-versioned keys. */
			coinjs.addressBalance(address, function (response) {
				var balance = balanceResponseAmount(response);
				if (!response || !response.success || balance == null) {
					d.reject((response && response.error) || (chainCode + ' balance lookup failed'));
					return;
				}
				d.resolve({ chainCode: chainCode, address: address, balance: balance });
			});
		} catch (error) {
			d.reject((error && error.message) ? error.message : String(error));
		} finally {
			coinjs.setNetwork(previousNetworkCode || 'ROD');
		}
		return d.promise();
	}

	function ensureWalletFundsForRole(role, rodAmount, ltcAmount) {
		var d = $.Deferred();
		if (!walletId || !walletId.wif) {
			d.reject('Open your wallet first');
			return d.promise();
		}
		var requiredChain = role === 'alice' ? 'ROD' : 'LTC';
		var requiredAmount = role === 'alice' ? rodAmount : ltcAmount;
		var requiredUnits = decimalToBaseUnits(requiredAmount);
		if (!requiredUnits || requiredUnits === '0') {
			d.reject('Enter a positive ' + requiredChain + ' amount');
			return d.promise();
		}
		var address = getWalletAddressForChain(walletId.wif, requiredChain);
		getChainBalance(requiredChain, address).then(function (result) {
			var balanceUnits = decimalToBaseUnits(result.balance);
			if (!balanceUnits) {
				d.reject('Could not parse ' + requiredChain + ' balance for ' + result.address);
				return;
			}
			if (isBaseUnitsLessThan(balanceUnits, requiredUnits)) {
				d.reject('Insufficient ' + requiredChain + ' balance in wallet ' + result.address + ': need ' + requiredAmount + ', available ' + result.balance);
				return;
			}
			d.resolve($.extend({}, result, {
				role: role,
				requiredAmount: requiredAmount,
				verifiedAt: new Date().toISOString()
			}));
		}, function (error) {
			d.reject('Could not verify ' + requiredChain + ' balance: ' + error);
		});
		return d.promise();
	}

	function buildLocalReadinessUnchecked(role, rodAmount, ltcAmount, reason) {
		var requiredChain = role === 'alice' ? 'ROD' : 'LTC';
		var requiredAmount = role === 'alice' ? rodAmount : ltcAmount;
		return {
			role: role,
			chain: requiredChain,
			address: getWalletAddressForChain(walletId.wif, requiredChain),
			requiredAmount: requiredAmount,
			observedBalance: 'unverified',
			verifiedAt: new Date().toISOString(),
			warning: reason || 'Balance API unavailable; readiness is local-only and funding may still fail'
		};
	}

	function readinessRoleChain(role) {
		return role === 'alice' ? 'ROD' : 'LTC';
	}

	function readinessRequiredAmount(session, role) {
		return role === 'alice' ? session.terms.rodAmount : session.terms.ltcAmount;
	}

	function readinessSummary(readiness) {
		if (!readiness) return '<span class="text-muted">not received</span>';
		var warning = readiness.warning ? ' · <span class="label label-warning">unverified</span> ' + esc(readiness.warning) : '';
		return '<code>' + esc(readiness.role || '—') + '</code> · ' + esc(readiness.chain || '—') +
			' · need ' + esc(readiness.requiredAmount) + ' · balance ' + esc(readiness.observedBalance) +
			' · <code style="font-size:10px">' + esc(short(readiness.address)) + '</code> · ' + esc(readiness.verifiedAt || '—') + warning;
	}

	function readinessMatches(session, readiness, expectedRole) {
		return !!(readiness && readiness.role === expectedRole && readiness.chain === readinessRoleChain(expectedRole) && readiness.requiredAmount === readinessRequiredAmount(session, expectedRole));
	}

	function saveLocalReadiness(session, readiness, note) {
		var liveSession = ENGINE.restoreLive(session.swapId) || session;
		liveSession.readiness = liveSession.readiness || {};
		liveSession.readiness.local = readiness;
		ENGINE.saveLive(liveSession);
		publish(liveSession, 'swap_ready', { readiness: liveSession.readiness.local });
		slog(liveSession.swapId, note || '→ Sent local readiness proof');
		markBilateralReady(liveSession);
		autoContinueSwap(liveSession);
		refreshSwaps();
		showActiveSwap(liveSession.swapId);
		return liveSession;
	}

	function buildReadinessEvidence(balanceProof) {
		return {
			role: balanceProof.role,
			chain: balanceProof.chainCode,
			address: balanceProof.address,
			requiredAmount: balanceProof.requiredAmount,
			observedBalance: balanceProof.balance,
			verifiedAt: balanceProof.verifiedAt
		};
	}

	function markBilateralReady(session) {
		var readiness = session.readiness || {};
		var remoteRole = session.role === 'alice' ? 'bob' : 'alice';
		if (session.bilateralReady || !readinessMatches(session, readiness.local, session.role) || !readinessMatches(session, readiness.remote, remoteRole)) return false;
		session.bilateralReady = true;
		session.timeline = session.timeline || [];
		session.timeline.push({ state: 'BILATERAL_READY', at: new Date().toISOString(), note: 'Local and remote balance readiness proofs present' });
		slog(session.swapId, '✓ Bilateral readiness proven for ' + readiness.local.chain + ' and ' + readiness.remote.chain);
		ENGINE.saveLive(session);
		return true;
	}

	function selectedSwap() {
		var visibleId = $('#otcAInfo code:first').text();
		var all = ENGINE.loadLive(), ids = Object.keys(all);
		for (var i = 0; i < ids.length; i++) if (ids[i] === visibleId) return ENGINE.restoreLive(ids[i]);
		if (ids.length === 1) return ENGINE.restoreLive(ids[0]);
		return null;
	}

	function publish(session, type, payload) {
		if (ENGINE.pool) ENGINE.publishSwapMessage(session, type, payload || {});
	}

	function shouldProcessRelayEvent(env) {
		var liveSessions = ENGINE.loadLive();
		if (liveSessions[env.swapId]) return true;
		if (ENGINE.trackedSwapIds && ENGINE.trackedSwapIds[env.swapId]) return true;
		return env.type === 'swap_terms';
	}

	function eventPubkey(eventObject) {
		return eventObject && eventObject.pubkey ? String(eventObject.pubkey) : '';
	}

	/* True when a relay replays one of OUR OWN events (e.g. after a page
	   reload, when the engine-level seen{} cache is empty). Signature and
	   claim handlers must never treat those as counterparty messages. */
	function isLocalEcho(sess, eventObject) {
		var pubkey = eventPubkey(eventObject);
		return !!(pubkey && sess.localNostrPubkey && pubkey === sess.localNostrPubkey);
	}

	function ensureRemotePeer(session, eventObject) {
		var pubkey = eventPubkey(eventObject);
		if (!pubkey) throw new Error('Remote OTC event is missing pubkey');
		if (session.localNostrPubkey && pubkey === session.localNostrPubkey) throw new Error('Ignoring local echo event');
		if (session.remoteNostrPubkey && session.remoteNostrPubkey !== pubkey) throw new Error('Remote OTC event pubkey mismatch');
		session.remoteNostrPubkey = pubkey;
		return pubkey;
	}

	function saveExecution(session, key, evidence) {
		/* Merge into the FRESHEST stored copy — saving the caller's (possibly
		   stale) session object wholesale can silently undo concurrent updates
		   made by other async automation steps. */
		var live = ENGINE.restoreLive(session.swapId) || session;
		live.execution = live.execution || {};
		live.execution[key] = $.extend({}, live.execution[key] || {}, evidence || {});
		session.execution = live.execution;
		ENGINE.saveLive(live);
		showActiveSwap(live.swapId);
		refreshSwaps();
	}

	/* Automation locks are IN-MEMORY per page run, never persisted. Persisting
	   them inside the session object caused ghost locks: an async callback
	   saving a stale session copy resurrected a lock that had already been
	   cleared, and the blocked step (e.g. the refund monitor) then waited out
	   the full staleness window. A page reload naturally clears these. */
	var automationLocks = {};
	function markAutomationBusy(session, key) {
		var lockKey = session.swapId + '|' + key;
		var stamp = automationLocks[lockKey];
		/* Stale after 120s: a swallowed error must not block the swap forever */
		if (stamp && (Date.now() - stamp) < 120000) return false;
		automationLocks[lockKey] = Date.now();
		return true;
	}

	function clearAutomationBusy(session, key) {
		delete automationLocks[session.swapId + '|' + key];
	}

	function fundingTarget(session, chainCode) {
		return chainCode === 'ROD' ? session.terms.rodFunding : session.terms.ltcFunding;
	}

	function payoutDestinationLabel(chainCode) {
		return chainCode === 'ROD' ? 'buyer ROD wallet address' : 'seller LTC wallet address';
	}

	function claimDestination(session, chainCode) {
		var address = chainCode === 'LTC' ? session.terms.sellerLtcPayoutAddress : session.terms.buyerRodPayoutAddress;
		if (!address) throw new Error('Missing ' + payoutDestinationLabel(chainCode) + ' in swap terms');
		return address;
	}

	function requireWalletWif() {
		if (!checkWallet() || !walletId || !walletId.wif) throw new Error('Open your wallet first');
		return walletId.wif;
	}

	function verifyFunding(session, chainCode, manualTxid) {
		var target = fundingTarget(session, chainCode);
		var txid = $.trim(manualTxid || (session.execution && session.execution[chainCode === 'ROD' ? 'rodFunding' : 'ltcFunding'] && session.execution[chainCode === 'ROD' ? 'rodFunding' : 'ltcFunding'].txid) || '');
		if (!txid) return $.Deferred().reject(new Error('Enter or receive ' + chainCode + ' funding txid first')).promise();
		return ENGINE.findFundingOutput(chainCode, txid, target.multisigAddress, target.amount).then(function (evidence) {
			/* Set ONLY here: this browser checked the chain API itself.
			   Remote evidence messages have this flag stripped on receipt. */
			evidence.verifiedLocally = true;
			saveExecution(session, chainCode === 'ROD' ? 'rodFunding' : 'ltcFunding', evidence);
			return evidence;
		});
	}

	function acceptSession(session, note) {
		session.localAccepted = true;
		if (session.state === 'OPEN') SWAP.safeAdvance(session, 'NEGOTIATING', note || 'Offer accepted');
		if (session.remoteAccepted) SWAP.safeAdvance(session, 'TERMS_ACCEPTED', note || 'Offer accepted');
		ENGINE.saveLive(session);
		publish(session, 'swap_accept', { accepted: true, acceptedAt: new Date().toISOString() });
		slog(session.swapId, session.remoteAccepted ? '→ Offer accepted; both peers accepted' : '→ Offer accepted; waiting for counterparty accept');
		autoContinueSwap(session);
	}

	function declineSession(session) {
		session.declined = true;
		session.declinedAt = new Date().toISOString();
		ENGINE.saveLive(session);
		publish(session, 'swap_decline', { declined: true, declinedAt: session.declinedAt });
		slog(session.swapId, '→ Offer declined');
		refreshSwaps();
		showActiveSwap(session.swapId);
	}

	var STATE_ORDER = ['OPEN', 'NEGOTIATING', 'TERMS_ACCEPTED', 'REFUNDS_READY', 'SIGNATURES_EXCHANGED', 'PREPARED', 'ALICE_ROD_FUNDED', 'BOB_LTC_FUNDED', 'READY', 'LTC_CLAIMED', 'SECRET_RECOVERED', 'ROD_CLAIMED', 'COMPLETE'];
	function stateRank(state) { return STATE_ORDER.indexOf(state); }
	function isTerminal(session) {
		return !session || session.declined || session.state === 'COMPLETE' ||
			session.state === 'REFUNDED' || session.state === 'PARTIALLY_SETTLED' ||
			session.state === 'ROD_REFUNDED' || session.state === 'LTC_REFUNDED';
	}

	function autoContinueSwap(session) {
		var latest = ENGINE.restoreLive(session.swapId) || session;
		if (isTerminal(latest)) return;
		if (SWAP.REFUND_STATES[latest.state]) { checkRefunds(latest); return; }
		var bothAccepted = !!(latest.localAccepted && latest.remoteAccepted);
		if (bothAccepted && latest.state === 'NEGOTIATING') {
			SWAP.safeAdvance(latest, 'TERMS_ACCEPTED', 'Both peers accepted offer');
			ENGINE.saveLive(latest);
		}
		if (!bothAccepted) return;
		/* Refund monitoring runs FIRST and independently of stage progress:
		   a stalled confirmation-wait loop must never starve the refund path
		   (checkRefunds is height-gated, lock-guarded and cheap). */
		checkRefunds(latest);
		if (advancePreFunding(latest)) return;
		if (advanceFunding(latest)) return;
		advanceSettlement(latest);
	}

	/* Consume stashed protocol payloads whose prerequisites have arrived.
	   Sync, idempotent, safe to call from handlers and from the tick. */
	function processPendingProtocol(sess) {
		var terms = sess.terms;
		/* Bob: verify + countersign Alice's ROD refund */
		if (sess.role === 'bob' && sess._pendingRodRefundSig && !sess.rodRefundCosigned && sess.plannedRodFunding) {
			try {
				var rodRefundTxB = refundTxFor(sess, 'ROD');
				if (!ENGINE.verifyDerSig(ENGINE.sighash(rodRefundTxB), terms.aliceChildPubKey, sess._pendingRodRefundSig)) {
					slog(sess.swapId, '✗ Alice ROD refund signature failed verification — dropped');
					sess._pendingRodRefundSig = '';
					ENGINE.saveLive(sess);
				} else {
					var bobRodRefundSig = ENGINE.signClaimTx('ROD', rodRefundTxB, getLocalChildWif(sess, 'ROD'));
					sess.rodRefund = $.extend({}, sess.rodRefund || {}, { remoteSig: sess._pendingRodRefundSig, localSig: bobRodRefundSig, lockHeight: terms.refundRodHeight });
					sess.rodRefundCosigned = true;
					sess._pendingRodRefundSig = '';
					ENGINE.saveLive(sess);
					publish(sess, 'swap_rod_refund_signature', { from: 'bob', signature: bobRodRefundSig, txid: sess.plannedRodFunding.txid, vout: 0, lockHeight: terms.refundRodHeight });
					slog(sess.swapId, '✓ Verified + countersigned Alice ROD refund (locktime ' + terms.refundRodHeight + ')');
				}
			} catch (rodCosignError) { slog(sess.swapId, 'ROD refund countersign pending: ' + (rodCosignError.message || rodCosignError)); }
		}
		/* Alice: verify + countersign Bob's LTC refund */
		if (sess.role === 'alice' && sess._pendingLtcRefundSig && !sess.ltcRefundCosigned && sess.plannedLtcFunding) {
			try {
				var ltcRefundTxA = refundTxFor(sess, 'LTC');
				if (!ENGINE.verifyDerSig(ENGINE.sighash(ltcRefundTxA), terms.bobChildPubKey, sess._pendingLtcRefundSig)) {
					slog(sess.swapId, '✗ Bob LTC refund signature failed verification — dropped');
					sess._pendingLtcRefundSig = '';
					ENGINE.saveLive(sess);
				} else {
					var aliceLtcRefundSig = ENGINE.signClaimTx('LTC', ltcRefundTxA, getLocalChildWif(sess, 'LTC'));
					sess.ltcRefund = $.extend({}, sess.ltcRefund || {}, { remoteSig: sess._pendingLtcRefundSig, localSig: aliceLtcRefundSig, lockHeight: terms.ltcRefundLockHeight });
					sess.ltcRefundCosigned = true;
					sess._pendingLtcRefundSig = '';
					ENGINE.saveLive(sess);
					publish(sess, 'swap_ltc_refund_signature', { from: 'alice', signature: aliceLtcRefundSig, txid: sess.plannedLtcFunding.txid, vout: 0, lockHeight: terms.ltcRefundLockHeight });
					slog(sess.swapId, '✓ Verified + countersigned Bob LTC refund (locktime ' + terms.ltcRefundLockHeight + ')');
				}
			} catch (ltcCosignError) { slog(sess.swapId, 'LTC refund countersign pending: ' + (ltcCosignError.message || ltcCosignError)); }
		}
		/* Alice: assemble her fully-signed ROD refund from Bob's countersig */
		if (sess.role === 'alice' && sess._pendingRodRefundCosig && sess.rodRefund && sess.rodRefund.localSig && !sess.rodRefund.signedHex) {
			try {
				var rodRefundTxA = refundTxFor(sess, 'ROD');
				if (!ENGINE.verifyDerSig(ENGINE.sighash(rodRefundTxA), terms.bobChildPubKey, sess._pendingRodRefundCosig)) {
					slog(sess.swapId, '✗ Bob ROD refund countersignature failed verification — dropped');
					sess._pendingRodRefundCosig = '';
					ENGINE.saveLive(sess);
				} else {
					var rodRefundOrdered = [sess.rodRefund.localSig, sess._pendingRodRefundCosig];
					if (verifyClaimSignatures(sess, rodRefundTxA, rodRefundOrdered)) {
						sess.rodRefund.remoteSig = sess._pendingRodRefundCosig;
						ENGINE.applyMultisigSignatures('ROD', rodRefundTxA, terms.rodFunding.redeemScript, rodRefundOrdered);
						sess.rodRefund.signedHex = rodRefundTxA.serialize();
						sess.rodRefund.txid = txidOfHex(sess.rodRefund.signedHex);
						sess._pendingRodRefundCosig = '';
						ENGINE.saveLive(sess);
						slog(sess.swapId, '✓ ROD refund fully signed (' + short(sess.rodRefund.txid) + ', locktime ' + terms.refundRodHeight + ') — ROD funding is now protected');
					} else {
						sess._pendingRodRefundCosig = '';
						ENGINE.saveLive(sess);
						slog(sess.swapId, '✗ Assembled ROD refund failed CHECKMULTISIG verification');
					}
				}
			} catch (rodAssembleError) { slog(sess.swapId, 'ROD refund assembly pending: ' + (rodAssembleError.message || rodAssembleError)); }
		}
		/* Bob: assemble his fully-signed LTC refund from Alice's countersig */
		if (sess.role === 'bob' && sess._pendingLtcRefundCosig && sess.ltcRefund && sess.ltcRefund.localSig && !sess.ltcRefund.signedHex) {
			try {
				var ltcRefundTxB = refundTxFor(sess, 'LTC');
				if (!ENGINE.verifyDerSig(ENGINE.sighash(ltcRefundTxB), terms.aliceChildPubKey, sess._pendingLtcRefundCosig)) {
					slog(sess.swapId, '✗ Alice LTC refund countersignature failed verification — dropped');
					sess._pendingLtcRefundCosig = '';
					ENGINE.saveLive(sess);
				} else {
					var ltcRefundOrdered = [sess._pendingLtcRefundCosig, sess.ltcRefund.localSig];
					if (verifyClaimSignatures(sess, ltcRefundTxB, ltcRefundOrdered)) {
						sess.ltcRefund.remoteSig = sess._pendingLtcRefundCosig;
						ENGINE.applyMultisigSignatures('LTC', ltcRefundTxB, terms.ltcFunding.redeemScript, ltcRefundOrdered);
						sess.ltcRefund.signedHex = ltcRefundTxB.serialize();
						sess.ltcRefund.txid = txidOfHex(sess.ltcRefund.signedHex);
						sess._pendingLtcRefundCosig = '';
						ENGINE.saveLive(sess);
						slog(sess.swapId, '✓ LTC refund fully signed (' + short(sess.ltcRefund.txid) + ', locktime ' + terms.ltcRefundLockHeight + ') — LTC funding is now protected');
					} else {
						sess._pendingLtcRefundCosig = '';
						ENGINE.saveLive(sess);
						slog(sess.swapId, '✗ Assembled LTC refund failed CHECKMULTISIG verification');
					}
				}
			} catch (ltcAssembleError) { slog(sess.swapId, 'LTC refund assembly pending: ' + (ltcAssembleError.message || ltcAssembleError)); }
		}
		/* Alice: verify Bob's LTC claim adaptor signature */
		if (sess.role === 'alice' && sess._pendingLtcAdaptorSig && !sess.remoteLtcAdaptorSignature && sess.plannedLtcFunding && sess.adaptorPoint) {
			try {
				var ltcClaimTxV = claimTxFor(sess, 'LTC');
				if (ENGINE.verifyAdaptorSig(ENGINE.sighash(ltcClaimTxV), terms.bobChildPubKey, sess.adaptorPoint, sess._pendingLtcAdaptorSig)) {
					sess.remoteLtcAdaptorSignature = sess._pendingLtcAdaptorSig;
					sess._pendingLtcAdaptorSig = '';
					ENGINE.saveLive(sess);
					slog(sess.swapId, '✓ Verified Bob LTC claim adaptor signature (DLEQ + pre-signature)');
				} else {
					sess._pendingLtcAdaptorSig = '';
					ENGINE.saveLive(sess);
					slog(sess.swapId, '✗ Bob LTC adaptor signature failed verification — dropped');
				}
			} catch (ltcAdaptorVerifyError) { slog(sess.swapId, 'LTC adaptor verify pending: ' + (ltcAdaptorVerifyError.message || ltcAdaptorVerifyError)); }
		}
		/* Bob: verify Alice's ROD claim adaptor signature */
		if (sess.role === 'bob' && sess._pendingRodAdaptorSig && !sess.remoteRodAdaptorSignature && sess.plannedRodFunding && sess.adaptorPoint) {
			try {
				var rodClaimTxV = claimTxFor(sess, 'ROD');
				if (ENGINE.verifyAdaptorSig(ENGINE.sighash(rodClaimTxV), terms.aliceChildPubKey, sess.adaptorPoint, sess._pendingRodAdaptorSig)) {
					sess.remoteRodAdaptorSignature = sess._pendingRodAdaptorSig;
					sess._pendingRodAdaptorSig = '';
					ENGINE.saveLive(sess);
					slog(sess.swapId, '✓ Verified Alice ROD claim adaptor signature (DLEQ + pre-signature)');
				} else {
					sess._pendingRodAdaptorSig = '';
					ENGINE.saveLive(sess);
					slog(sess.swapId, '✗ Alice ROD adaptor signature failed verification — dropped');
				}
			} catch (rodAdaptorVerifyError) { slog(sess.swapId, 'ROD adaptor verify pending: ' + (rodAdaptorVerifyError.message || rodAdaptorVerifyError)); }
		}
	}

	/* ---- Stage 1: pre-funding pipeline ----
	   Plan (sign, DO NOT broadcast) own funding → exchange pre-signed
	   timelocked refunds → exchange claim adaptor signatures → PREPARED.
	   Nothing touches a chain until every dependent transaction is verified
	   locally. Returns true when it performed or started a step. */
	function advancePreFunding(sess) {
		if (stateRank(sess.state) >= stateRank('PREPARED')) return false;
		processPendingProtocol(sess);
		var terms = sess.terms;
		/* Lazy adaptor-point generation & re-publish for Alice.
		   Covers edge cases: session created before fix was deployed,
		   or the initial relay publish was lost / rate-limited. */
		if (sess.role === 'alice') {
			if (!sess.adaptorSecret) {
				var y = coinjs.adaptor.generateSecret();
				sess.adaptorSecret = y;
				sess.adaptorPoint = coinjs.adaptor.publicKey(y);
				ENGINE.saveLive(sess);
				slog(sess.swapId, '⚠ Lazy-generated adaptor secret (missed at session creation)');
			}
			if (sess.adaptorPoint && !sess.remotePrepared) {
				publish(sess, 'swap_adaptor_point', { adaptorPoint: sess.adaptorPoint });
			}
		}
		if (sess.role === 'alice') {
			/* Plan ROD funding */
			if (!sess.plannedRodFunding && sess.bilateralReady) {
				if (!markAutomationBusy(sess, 'planRod')) return true;
				ENGINE.buildFundingTx('ROD', requireWalletWif(), terms.rodFunding.multisigAddress, terms.rodAmount, fundingFee('ROD')).then(function (built) {
					var live = ENGINE.restoreLive(sess.swapId) || sess;
					live.plannedRodFunding = { txid: built.txid, vout: 0, value: CHAINS.decimalToSats(terms.rodAmount), amount: terms.rodAmount, txhex: built.txhex };
					ENGINE.saveLive(live);
					publish(live, 'swap_rod_funding_planned', { txid: built.txid, vout: 0, value: live.plannedRodFunding.value, amount: terms.rodAmount });
					slog(live.swapId, '→ Planned ROD funding ' + short(built.txid) + ' (signed, NOT broadcast)');
					clearAutomationBusy(sess, 'planRod');
					autoContinueSwap(live);
				}).fail(function (error) {
					clearAutomationBusy(sess, 'planRod');
					slog(sess.swapId, 'ROD funding planning blocked: ' + (error && error.message || error));
				});
				return true;
			}
			/* Sign own ROD refund and send it for countersignature */
			if (sess.plannedRodFunding && !(sess.rodRefund && sess.rodRefund.localSig)) {
				try {
					var rodRefundTx = refundTxFor(sess, 'ROD');
					var rodRefundSig = ENGINE.signClaimTx('ROD', rodRefundTx, getLocalChildWif(sess, 'ROD'));
					sess.rodRefund = $.extend({}, sess.rodRefund || {}, {
						lockHeight: terms.refundRodHeight, destination: terms.sellerRodRefundAddress,
						fee: refundFee(sess, 'ROD'), localSig: rodRefundSig
					});
					ENGINE.saveLive(sess);
					publish(sess, 'swap_rod_refund_signature', { from: 'alice', signature: rodRefundSig, txid: sess.plannedRodFunding.txid, vout: 0, value: sess.plannedRodFunding.value, lockHeight: terms.refundRodHeight });
					slog(sess.swapId, '→ Signed ROD refund (locktime ' + terms.refundRodHeight + '); requested Bob countersignature');
				} catch (rodRefundError) { slog(sess.swapId, 'ROD refund signing blocked: ' + (rodRefundError.message || rodRefundError)); }
				return true;
			}
			/* Send ROD claim adaptor signature once the refund layer is safe:
			   own refund fully signed and Bob's refund countersigned. */
			if (sess.rodRefund && sess.rodRefund.signedHex && sess.plannedLtcFunding && sess.ltcRefundCosigned && sess.adaptorPoint && !sess.localRodAdaptorSignature) {
				try {
					var rodClaimTx = claimTxFor(sess, 'ROD');
					var rodAdaptor = ENGINE.makeAdaptorSig(sess, rodClaimTx);
					sess.localRodAdaptorSignature = rodAdaptor.hex;
					SWAP.safeAdvance(sess, 'REFUNDS_READY', 'Both timelocked refunds pre-signed');
					ENGINE.saveLive(sess);
					publish(sess, 'swap_rod_adaptor_signature', { hex: rodAdaptor.hex, txid: sess.plannedRodFunding.txid, vout: 0 });
					slog(sess.swapId, '→ Sent ROD claim adaptor signature (encrypted to adaptor point)');
				} catch (rodAdaptorError) { slog(sess.swapId, 'ROD adaptor signing blocked: ' + (rodAdaptorError.message || rodAdaptorError)); }
				return true;
			}
			/* PREPARED gate */
			if (sess.localRodAdaptorSignature && sess.remoteLtcAdaptorSignature && sess.rodRefund && sess.rodRefund.signedHex && !sess.localPrepared) {
				SWAP.safeAdvance(sess, 'SIGNATURES_EXCHANGED', 'Adaptor signatures exchanged and verified');
				SWAP.safeAdvance(sess, 'PREPARED', 'All pre-funding requirements verified');
				sess.localPrepared = true;
				ENGINE.saveLive(sess);
				publish(sess, 'swap_prepared', { prepared: true });
				slog(sess.swapId, '✓ PREPARED — refunds signed, adaptor signatures verified; funding is safe');
				refreshSwaps();
				return true;
			}
			return false;
		}
		/* --- Bob --- */
		if (sess.role === 'bob') {
			/* Plan LTC funding */
			if (!sess.plannedLtcFunding && sess.bilateralReady) {
				if (!markAutomationBusy(sess, 'planLtc')) return true;
				ENGINE.buildFundingTx('LTC', requireWalletWif(), terms.ltcFunding.multisigAddress, terms.ltcAmount, fundingFee('LTC')).then(function (built) {
					var live = ENGINE.restoreLive(sess.swapId) || sess;
					live.plannedLtcFunding = { txid: built.txid, vout: 0, value: CHAINS.decimalToSats(terms.ltcAmount), amount: terms.ltcAmount, txhex: built.txhex };
					ENGINE.saveLive(live);
					publish(live, 'swap_ltc_funding_planned', { txid: built.txid, vout: 0, value: live.plannedLtcFunding.value, amount: terms.ltcAmount });
					slog(live.swapId, '→ Planned LTC funding ' + short(built.txid) + ' (signed, NOT broadcast)');
					clearAutomationBusy(sess, 'planLtc');
					autoContinueSwap(live);
				}).fail(function (error) {
					clearAutomationBusy(sess, 'planLtc');
					slog(sess.swapId, 'LTC funding planning blocked: ' + (error && error.message || error));
				});
				return true;
			}
			/* Sign own LTC refund and send for countersignature */
			if (sess.plannedLtcFunding && !(sess.ltcRefund && sess.ltcRefund.localSig)) {
				try {
					var ltcRefundTx = refundTxFor(sess, 'LTC');
					var ltcRefundSig = ENGINE.signClaimTx('LTC', ltcRefundTx, getLocalChildWif(sess, 'LTC'));
					sess.ltcRefund = $.extend({}, sess.ltcRefund || {}, {
						lockHeight: terms.ltcRefundLockHeight, destination: terms.buyerLtcRefundAddress,
						fee: refundFee(sess, 'LTC'), localSig: ltcRefundSig
					});
					ENGINE.saveLive(sess);
					publish(sess, 'swap_ltc_refund_signature', { from: 'bob', signature: ltcRefundSig, txid: sess.plannedLtcFunding.txid, vout: 0, value: sess.plannedLtcFunding.value, lockHeight: terms.ltcRefundLockHeight });
					slog(sess.swapId, '→ Signed LTC refund (locktime ' + terms.ltcRefundLockHeight + '); requested Alice countersignature');
				} catch (ltcRefundError) { slog(sess.swapId, 'LTC refund signing blocked: ' + (ltcRefundError.message || ltcRefundError)); }
				return true;
			}
			/* Send LTC claim adaptor signature */
			if (sess.ltcRefund && sess.ltcRefund.signedHex && sess.plannedRodFunding && sess.rodRefundCosigned && sess.adaptorPoint && !sess.localLtcAdaptorSignature) {
				try {
					var ltcClaimTx = claimTxFor(sess, 'LTC');
					var ltcAdaptor = ENGINE.makeAdaptorSig(sess, ltcClaimTx);
					sess.localLtcAdaptorSignature = ltcAdaptor.hex;
					SWAP.safeAdvance(sess, 'REFUNDS_READY', 'Both timelocked refunds pre-signed');
					ENGINE.saveLive(sess);
					publish(sess, 'swap_ltc_adaptor_signature', { hex: ltcAdaptor.hex, txid: sess.plannedLtcFunding.txid, vout: 0 });
					slog(sess.swapId, '→ Sent LTC claim adaptor signature (encrypted to adaptor point)');
				} catch (ltcAdaptorError) { slog(sess.swapId, 'LTC adaptor signing blocked: ' + (ltcAdaptorError.message || ltcAdaptorError)); }
				return true;
			}
			/* PREPARED gate */
			if (sess.localLtcAdaptorSignature && sess.remoteRodAdaptorSignature && sess.ltcRefund && sess.ltcRefund.signedHex && !sess.localPrepared) {
				SWAP.safeAdvance(sess, 'SIGNATURES_EXCHANGED', 'Adaptor signatures exchanged and verified');
				SWAP.safeAdvance(sess, 'PREPARED', 'All pre-funding requirements verified');
				sess.localPrepared = true;
				ENGINE.saveLive(sess);
				publish(sess, 'swap_prepared', { prepared: true });
				slog(sess.swapId, '✓ PREPARED — refunds signed, adaptor signatures verified; funding is safe');
				refreshSwaps();
				return true;
			}
			return false;
		}
		return false;
	}

	function confirmedEnough(evidence, requiredConfirmations) {
		return !!(evidence && evidence.verifiedLocally && (evidence.confirmations || 0) >= (requiredConfirmations || 1));
	}

	/* ---- Stage 2: gated funding ----
	   Alice broadcasts her PRE-SIGNED planned ROD funding only from PREPARED
	   (with the counterparty also prepared). Bob broadcasts LTC only after the
	   on-chain ROD funding txid matches the planned txid AND reaches the
	   agreed confirmation count. */
	function advanceFunding(sess) {
		if (stateRank(sess.state) < stateRank('PREPARED')) return false;
		var terms = sess.terms;
		var execution = sess.execution || {};
		var rodFunding = execution.rodFunding || null;
		var ltcFunding = execution.ltcFunding || null;
		if (sess.role === 'alice') {
			if (!(rodFunding && rodFunding.txid)) {
				if (!sess.remotePrepared) { slog(sess.swapId, 'Waiting for counterparty PREPARED before ROD funding broadcast'); return true; }
				if (!markAutomationBusy(sess, 'fundRod')) return true;
				ENGINE.broadcastTx('ROD', sess.plannedRodFunding.txhex).then(function (response) {
					var live = ENGINE.restoreLive(sess.swapId) || sess;
					live.execution = live.execution || {};
					live.execution.rodFunding = {
						txid: (response && response.txid) || live.plannedRodFunding.txid, vout: 0,
						value: live.plannedRodFunding.value, amount: live.plannedRodFunding.amount,
						broadcastAt: new Date().toISOString()
					};
					SWAP.safeAdvance(live, 'ALICE_ROD_FUNDED', 'ROD funding broadcast');
					ENGINE.saveLive(live);
					publish(live, 'swap_rod_funded', { funding: { txid: live.execution.rodFunding.txid, vout: 0, value: live.execution.rodFunding.value, amount: live.execution.rodFunding.amount } });
					slog(live.swapId, '→ ROD funding broadcast ' + live.execution.rodFunding.txid);
					clearAutomationBusy(sess, 'fundRod');
					refreshSwaps(); showActiveSwap(live.swapId);
					autoContinueSwap(live);
				}).fail(function (error) {
					clearAutomationBusy(sess, 'fundRod');
					slog(sess.swapId, 'ROD funding broadcast blocked: ' + (error && error.message || error));
				});
				return true;
			}
			/* Self-verify own ROD funding until confirmation target reached */
			if (rodFunding.txid && !confirmedEnough(rodFunding, terms.rodConfirmations)) {
				if (!markAutomationBusy(sess, 'verifyRodSelf')) return true;
				verifyFunding(sess, 'ROD', sess.plannedRodFunding.txid).then(function (evidence) {
					var live = ENGINE.restoreLive(sess.swapId) || sess;
					var cleanEvidence = $.extend({}, evidence); delete cleanEvidence.verifiedLocally;
					publish(live, 'swap_rod_funded', { funding: cleanEvidence });
					slog(live.swapId, '✓ Own ROD funding verified · ' + (evidence.confirmations || 0) + '/' + terms.rodConfirmations + ' confs');
					clearAutomationBusy(sess, 'verifyRodSelf');
					autoContinueSwap(live);
				}).fail(function (error) {
					clearAutomationBusy(sess, 'verifyRodSelf');
					slog(sess.swapId, 'Own ROD verify pending: ' + (error && error.message || error));
				});
				return true;
			}
			/* Verify Bob's LTC funding (must match his planned txid) → READY */
			if (sess.plannedLtcFunding && !confirmedEnough(ltcFunding, terms.ltcConfirmations)) {
				if (!markAutomationBusy(sess, 'verifyLtc')) return true;
				verifyFunding(sess, 'LTC', sess.plannedLtcFunding.txid).then(function (evidence) {
					var live = ENGINE.restoreLive(sess.swapId) || sess;
					SWAP.safeAdvance(live, 'BOB_LTC_FUNDED', 'LTC funding verified on-chain');
					if ((evidence.confirmations || 0) >= terms.ltcConfirmations) {
						SWAP.safeAdvance(live, 'READY', 'LTC funding reached ' + terms.ltcConfirmations + ' confirmation(s)');
					}
					ENGINE.saveLive(live);
					slog(live.swapId, '✓ LTC funding verified · ' + (evidence.confirmations || 0) + '/' + terms.ltcConfirmations + ' confs');
					clearAutomationBusy(sess, 'verifyLtc');
					autoContinueSwap(live);
				}).fail(function (error) {
					clearAutomationBusy(sess, 'verifyLtc');
					slog(sess.swapId, 'LTC funding verify pending: ' + (error && error.message || error));
				});
				return true;
			}
			if (confirmedEnough(ltcFunding, terms.ltcConfirmations) && stateRank(sess.state) < stateRank('READY')) {
				SWAP.safeAdvance(sess, 'READY', 'Both fundings confirmed');
				ENGINE.saveLive(sess);
				return true;
			}
			return false;
		}
		if (sess.role === 'bob') {
			/* Verify Alice's ROD funding (gate: on-chain txid == planned txid,
			   confirmations >= agreed) before committing any LTC. */
			if (!(ltcFunding && ltcFunding.txid)) {
				if (!sess.plannedRodFunding) return false;
				var rodOk = confirmedEnough(rodFunding, terms.rodConfirmations) && rodFunding.txid === sess.plannedRodFunding.txid;
				if (!rodOk) {
					if (!markAutomationBusy(sess, 'verifyRod')) return true;
					verifyFunding(sess, 'ROD', sess.plannedRodFunding.txid).then(function (evidence) {
						var live = ENGINE.restoreLive(sess.swapId) || sess;
						SWAP.safeAdvance(live, 'ALICE_ROD_FUNDED', 'ROD funding verified on-chain');
						ENGINE.saveLive(live);
						slog(live.swapId, '✓ ROD funding verified · ' + (evidence.confirmations || 0) + '/' + terms.rodConfirmations + ' confs · txid matches planned');
						clearAutomationBusy(sess, 'verifyRod');
						autoContinueSwap(live);
					}).fail(function (error) {
						clearAutomationBusy(sess, 'verifyRod');
						slog(sess.swapId, 'ROD funding verify pending: ' + (error && error.message || error));
					});
					return true;
				}
				/* Adaptor signature sanity re-check against the REAL funding */
				if (!sess.remoteRodAdaptorSignature) { slog(sess.swapId, 'Missing Alice ROD adaptor signature; not funding LTC'); return true; }
				if (!markAutomationBusy(sess, 'fundLtc')) return true;
				ENGINE.broadcastTx('LTC', sess.plannedLtcFunding.txhex).then(function (response) {
					var live = ENGINE.restoreLive(sess.swapId) || sess;
					live.execution = live.execution || {};
					live.execution.ltcFunding = {
						txid: (response && response.txid) || live.plannedLtcFunding.txid, vout: 0,
						value: live.plannedLtcFunding.value, amount: live.plannedLtcFunding.amount,
						broadcastAt: new Date().toISOString()
					};
					SWAP.safeAdvance(live, 'BOB_LTC_FUNDED', 'LTC funding broadcast');
					ENGINE.saveLive(live);
					publish(live, 'swap_ltc_funded', { funding: { txid: live.execution.ltcFunding.txid, vout: 0, value: live.execution.ltcFunding.value, amount: live.execution.ltcFunding.amount } });
					slog(live.swapId, '→ LTC funding broadcast ' + live.execution.ltcFunding.txid);
					clearAutomationBusy(sess, 'fundLtc');
					refreshSwaps(); showActiveSwap(live.swapId);
					autoContinueSwap(live);
				}).fail(function (error) {
					clearAutomationBusy(sess, 'fundLtc');
					slog(sess.swapId, 'LTC funding broadcast blocked: ' + (error && error.message || error));
				});
				return true;
			}
			/* Self-verify own LTC funding until confirmation target reached */
			if (ltcFunding.txid && !confirmedEnough(ltcFunding, terms.ltcConfirmations)) {
				if (!markAutomationBusy(sess, 'verifyLtcSelf')) return true;
				verifyFunding(sess, 'LTC', sess.plannedLtcFunding.txid).then(function (evidence) {
					var live = ENGINE.restoreLive(sess.swapId) || sess;
					var cleanEvidence = $.extend({}, evidence); delete cleanEvidence.verifiedLocally;
					publish(live, 'swap_ltc_funded', { funding: cleanEvidence });
					if ((evidence.confirmations || 0) >= terms.ltcConfirmations) {
						SWAP.safeAdvance(live, 'READY', 'LTC funding reached ' + terms.ltcConfirmations + ' confirmation(s)');
						ENGINE.saveLive(live);
					}
					slog(live.swapId, '✓ Own LTC funding verified · ' + (evidence.confirmations || 0) + '/' + terms.ltcConfirmations + ' confs');
					clearAutomationBusy(sess, 'verifyLtcSelf');
					autoContinueSwap(live);
				}).fail(function (error) {
					clearAutomationBusy(sess, 'verifyLtcSelf');
					slog(sess.swapId, 'Own LTC verify pending: ' + (error && error.message || error));
				});
				return true;
			}
			return false;
		}
		return false;
	}

	/* ---- Stage 3: atomic settlement ----
	   Alice completes Bob's LTC adaptor signature with y and broadcasts the
	   LTC claim (revealing y in the real signature). Bob recovers y from that
	   signature — via Nostr evidence or directly from the chain — completes
	   Alice's ROD adaptor signature and claims ROD. */
	function advanceSettlement(sess) {
		var terms = sess.terms;
		var execution = sess.execution || {};
		if (sess.role === 'alice') {
			if (!confirmedEnough(execution.ltcFunding, terms.ltcConfirmations)) return false;
			if (execution.ltcClaim && execution.ltcClaim.txid) return false;
			if (!sess.remoteLtcAdaptorSignature || !sess.adaptorSecret) return false;
			if (!markAutomationBusy(sess, 'claimLtc')) return true;
			ENGINE.getRodHeight().then(function (rodHeight) {
				if (rodHeight < terms.releaseRodHeight) {
					slog(sess.swapId, 'LTC claim waiting for release height ' + terms.releaseRodHeight + ' (current ' + rodHeight + ')');
					clearAutomationBusy(sess, 'claimLtc');
					return;
				}
				var live = ENGINE.restoreLive(sess.swapId) || sess;
				try {
					claimLtcAsAlice(live).then(function (evidence) {
						var updated = ENGINE.restoreLive(live.swapId) || live;
						SWAP.safeAdvance(updated, 'LTC_CLAIMED', 'LTC claimed with completed adaptor signature');
						ENGINE.saveLive(updated);
						slog(updated.swapId, '✓ LTC claimed ' + evidence.txid + ' — adaptor secret is now revealed on-chain');
						clearAutomationBusy(sess, 'claimLtc');
						refreshSwaps(); showActiveSwap(updated.swapId);
					}).fail(function (error) {
						clearAutomationBusy(sess, 'claimLtc');
						slog(sess.swapId, 'LTC claim blocked: ' + (error && error.message || error));
					});
				} catch (claimError) {
					clearAutomationBusy(sess, 'claimLtc');
					slog(sess.swapId, 'LTC claim blocked: ' + (claimError.message || claimError));
				}
			}, function (heightError) {
				clearAutomationBusy(sess, 'claimLtc');
				slog(sess.swapId, 'ROD height check failed: ' + (heightError && heightError.message || heightError));
			});
			return true;
		}
		if (sess.role === 'bob') {
			/* Recover the adaptor secret from the real LTC claim signature */
			if (!sess.recoveredAdaptorSecret && sess.localLtcAdaptorSignature && execution.ltcFunding && execution.ltcFunding.txid) {
				if (execution.ltcClaim && (execution.ltcClaim.completedSigHex || execution.ltcClaim.txhex)) {
					if (tryRecoverFromEvidence(sess)) { autoContinueSwap(ENGINE.restoreLive(sess.swapId) || sess); }
					return true;
				}
				/* Chain fallback: poll the LTC funding outpoint spend status so
				   recovery works even if every relay drops the notification. */
				if (!markAutomationBusy(sess, 'pollLtcSpend')) return true;
				ENGINE.getOutspend('LTC', sess.plannedLtcFunding.txid, 0).then(function (outspend) {
					if (!outspend || !outspend.spent || !outspend.txid) {
						clearAutomationBusy(sess, 'pollLtcSpend');
						return;
					}
					return ENGINE.getTxHex('LTC', outspend.txid).then(function (txhex) {
						var live = ENGINE.restoreLive(sess.swapId) || sess;
						live.execution = live.execution || {};
						live.execution.ltcClaim = $.extend({}, live.execution.ltcClaim || {}, { txid: outspend.txid, txhex: txhex });
						ENGINE.saveLive(live);
						slog(live.swapId, '← LTC claim discovered on-chain ' + short(outspend.txid));
						clearAutomationBusy(sess, 'pollLtcSpend');
						if (tryRecoverFromEvidence(live)) autoContinueSwap(ENGINE.restoreLive(live.swapId) || live);
					});
				}).fail(function () { clearAutomationBusy(sess, 'pollLtcSpend'); });
				return true;
			}
			/* Claim ROD with the recovered secret */
			if (sess.recoveredAdaptorSecret && sess.remoteRodAdaptorSignature && !(execution.rodClaim && execution.rodClaim.txid)) {
				if (!markAutomationBusy(sess, 'claimRod')) return true;
				try {
					claimRodAsBob(sess).then(function (evidence) {
						var live = ENGINE.restoreLive(sess.swapId) || sess;
						SWAP.safeAdvance(live, 'ROD_CLAIMED', 'ROD claimed with completed adaptor signature');
						SWAP.safeAdvance(live, 'COMPLETE', 'Swap complete');
						ENGINE.saveLive(live);
						ENGINE.recordTrade(live);
						publish(live, 'swap_complete', { rodClaim: { txid: evidence.txid } });
						slog(live.swapId, '✓ COMPLETE — ROD claimed ' + evidence.txid);
						clearAutomationBusy(sess, 'claimRod');
						refreshSwaps(); showActiveSwap(live.swapId); refreshHistory();
					}).fail(function (error) {
						clearAutomationBusy(sess, 'claimRod');
						slog(sess.swapId, 'ROD claim blocked: ' + (error && error.message || error));
					});
				} catch (rodClaimError) {
					clearAutomationBusy(sess, 'claimRod');
					slog(sess.swapId, 'ROD claim blocked: ' + (rodClaimError.message || rodClaimError));
				}
				return true;
			}
			return false;
		}
		return false;
	}

	/* Extract Bob's completed signature from the LTC claim evidence and
	   recover the adaptor secret. recover() itself validates the candidate
	   against the adaptor point (yG == Y, or the low-S negation), so a forged
	   signature cannot inject a bogus secret. */
	function tryRecoverFromEvidence(sess) {
		if (sess.role !== 'bob' || sess.recoveredAdaptorSecret || !sess.localLtcAdaptorSignature) return false;
		var evidence = sess.execution && sess.execution.ltcClaim;
		if (!evidence) return false;
		var candidates = [];
		if (evidence.completedSigHex) candidates.push(evidence.completedSigHex);
		if (evidence.txhex) {
			try {
				var extracted = ENGINE.extractMultisigScriptSigSigs(evidence.txhex);
				/* Redeem order is [alice, bob] — Bob's completed sig is second,
				   but try every extracted signature for robustness. */
				for (var i = extracted.signatures.length - 1; i >= 0; i--) candidates.push(extracted.signatures[i]);
			} catch (extractError) { slog(sess.swapId, 'Claim scriptSig parse failed: ' + (extractError.message || extractError)); }
		}
		for (var c = 0; c < candidates.length; c++) {
			try {
				var recovered = ENGINE.recoverSecret(Crypto.util.hexToBytes(sess.localLtcAdaptorSignature), candidates[c], sess.adaptorPoint);
				sess.recoveredAdaptorSecret = recovered;
				SWAP.safeAdvance(sess, 'LTC_CLAIMED', 'LTC claim observed');
				SWAP.safeAdvance(sess, 'SECRET_RECOVERED', 'Adaptor secret recovered from the real LTC claim signature');
				ENGINE.saveLive(sess);
				publish(sess, 'swap_secret_recovered', { recovered: true });
				slog(sess.swapId, '✓ Adaptor secret recovered from LTC claim signature (verified against adaptor point)');
				refreshSwaps();
				return true;
			} catch (recoverError) { /* try next candidate */ }
		}
		slog(sess.swapId, 'Secret recovery failed for all candidate signatures; will retry');
		return false;
	}

	/* ---- Stage 4: refund monitoring ----
	   Runs when the swap is stalled. Broadcasts the PRE-SIGNED timelocked
	   refund once the lock height passes and the funding output is still
	   unspent. An honest Alice never refunds after claiming LTC. */
	function checkRefunds(sess) {
		var terms = sess.terms;
		var execution = sess.execution || {};
		if (sess.state === 'COMPLETE') return;
		if (sess.role === 'alice' && sess.rodRefund && sess.rodRefund.signedHex &&
			execution.rodFunding && execution.rodFunding.txid &&
			!(execution.ltcClaim && execution.ltcClaim.txid) &&
			!(execution.rodRefund && execution.rodRefund.txid)) {
			if (!markAutomationBusy(sess, 'refundRod')) return;
			ENGINE.getRodHeight().then(function (rodHeight) {
				if (rodHeight < terms.refundRodHeight) {
					clearAutomationBusy(sess, 'refundRod');
					return;
				}
				return ENGINE.isOutpointUnspent('ROD', terms.rodFunding.multisigAddress, sess.plannedRodFunding.txid, 0).then(function (status) {
					if (!status.unspent) {
						clearAutomationBusy(sess, 'refundRod');
						slog(sess.swapId, 'ROD refund not needed: funding output already spent');
						return;
					}
					return ENGINE.broadcastTx('ROD', sess.rodRefund.signedHex).then(function (response) {
						var live = ENGINE.restoreLive(sess.swapId) || sess;
						live.execution = live.execution || {};
						live.execution.rodRefund = { txid: (response && response.txid) || txidOfHex(live.rodRefund.signedHex), txhex: live.rodRefund.signedHex, broadcastAt: new Date().toISOString() };
						SWAP.markRefundState(live, 'ROD_REFUND_BROADCAST', 'Timelocked ROD refund broadcast at height ' + rodHeight);
						SWAP.markRefundState(live, (execution.ltcFunding && execution.ltcFunding.txid) ? 'ROD_REFUNDED' : 'REFUNDED', 'ROD refund accepted by network');
						ENGINE.saveLive(live);
						publish(live, 'swap_rod_refund_broadcast', { txid: live.execution.rodRefund.txid });
						if (live.state === 'REFUNDED') publish(live, 'swap_refunded', { chain: 'ROD' });
						slog(live.swapId, '✓ ROD refund broadcast ' + live.execution.rodRefund.txid + ' — funds returned to ' + terms.sellerRodRefundAddress);
						clearAutomationBusy(sess, 'refundRod');
						refreshSwaps(); showActiveSwap(live.swapId);
					});
				});
			}).fail(function (error) {
				clearAutomationBusy(sess, 'refundRod');
				slog(sess.swapId, 'ROD refund check failed: ' + (error && error.message || error));
			});
			return;
		}
		if (sess.role === 'bob' && sess.ltcRefund && sess.ltcRefund.signedHex &&
			execution.ltcFunding && execution.ltcFunding.txid &&
			!sess.recoveredAdaptorSecret &&
			!(execution.ltcRefund && execution.ltcRefund.txid)) {
			if (!markAutomationBusy(sess, 'refundLtc')) return;
			ENGINE.getLtcHeight().then(function (ltcHeight) {
				if (ltcHeight < terms.ltcRefundLockHeight) {
					clearAutomationBusy(sess, 'refundLtc');
					return;
				}
				return ENGINE.isOutpointUnspent('LTC', terms.ltcFunding.multisigAddress, sess.plannedLtcFunding.txid, 0).then(function (status) {
					if (!status.unspent) {
						/* Spent but no secret yet → Alice claimed; recovery path
						   will pick it up via outspend polling. */
						clearAutomationBusy(sess, 'refundLtc');
						slog(sess.swapId, 'LTC refund skipped: funding output spent (checking for Alice claim)');
						autoContinueSwap(ENGINE.restoreLive(sess.swapId) || sess);
						return;
					}
					return ENGINE.broadcastTx('LTC', sess.ltcRefund.signedHex).then(function (response) {
						var live = ENGINE.restoreLive(sess.swapId) || sess;
						live.execution = live.execution || {};
						live.execution.ltcRefund = { txid: (response && response.txid) || txidOfHex(live.ltcRefund.signedHex), txhex: live.ltcRefund.signedHex, broadcastAt: new Date().toISOString() };
						SWAP.markRefundState(live, 'LTC_REFUND_BROADCAST', 'Timelocked LTC refund broadcast at height ' + ltcHeight);
						SWAP.markRefundState(live, 'LTC_REFUNDED', 'LTC refund accepted by network');
						ENGINE.saveLive(live);
						publish(live, 'swap_ltc_refund_broadcast', { txid: live.execution.ltcRefund.txid });
						slog(live.swapId, '✓ LTC refund broadcast ' + live.execution.ltcRefund.txid + ' — funds returned to ' + terms.buyerLtcRefundAddress);
						clearAutomationBusy(sess, 'refundLtc');
						refreshSwaps(); showActiveSwap(live.swapId);
					});
				});
			}).fail(function (error) {
				clearAutomationBusy(sess, 'refundLtc');
				slog(sess.swapId, 'LTC refund check failed: ' + (error && error.message || error));
			});
		}
	}

	function getLocalChildWif(session, chainCode) {
		if (!session.localChildPrivateKey) throw new Error('Local swap child private key is unavailable; reopen the wallet that created this session');
		return CHAINS.withChain(chainCode, function () {
			return coinjs.privkey2wif(session.localChildPrivateKey);
		});
	}

	/* Emulate OP_CHECKMULTISIG before broadcast: every signature must verify,
	   in order, against the redeem-script pubkeys [alice, bob]. Catches a bad
	   or misattributed counterparty signature locally instead of broadcasting
	   a transaction the network is guaranteed to reject. */
	function verifyClaimSignatures(session, tx, orderedSigs) {
		var redeemPubkeys = [session.terms.aliceChildPubKey, session.terms.bobChildPubKey];
		var sighash = Crypto.util.hexToBytes(tx.transactionHash(0, 1));
		var pubkeyIndex = 0;
		for (var i = 0; i < orderedSigs.length; i++) {
			if (!orderedSigs[i]) return false;
			var sigBytes = Crypto.util.hexToBytes(orderedSigs[i]);
			var matched = false;
			while (pubkeyIndex < redeemPubkeys.length && !matched) {
				var decompressed = coinjs.pubkeydecompress(redeemPubkeys[pubkeyIndex]);
				pubkeyIndex++;
				if (!decompressed) continue;
				try { matched = coinjs.verifySignature(sighash, sigBytes, Crypto.util.hexToBytes(decompressed)); }
				catch (verifyError) { matched = false; }
			}
			if (!matched) return false;
		}
		return true;
	}

	function txidOfHex(txhex) {
		try {
			var firstHash = Crypto.SHA256(Crypto.util.hexToBytes(txhex), { asBytes: true });
			return Crypto.util.bytesToHex(Crypto.SHA256(firstHash, { asBytes: true }).reverse());
		} catch (hashError) { return ''; }
	}

	/* Generic 2-of-2 claim broadcaster. orderedSigs MUST match the redeem
	   pubkey order [alice, bob]; every signature is CHECKMULTISIG-verified
	   locally before broadcast. */
	function broadcastClaim(session, chainCode, orderedSigs, claimKey, messageType, extraEvidence) {
		var tx = claimTxFor(session, chainCode);
		if (!verifyClaimSignatures(session, tx, orderedSigs)) {
			throw new Error(chainCode + ' claim signatures failed local CHECKMULTISIG verification');
		}
		var redeemScript = fundingTarget(session, chainCode).redeemScript;
		ENGINE.applyMultisigSignatures(chainCode, tx, redeemScript, orderedSigs);
		var claimTxHex = tx.serialize();
		var claimTxid = txidOfHex(claimTxHex);
		slog(session.swapId, '→ Broadcasting ' + chainCode + ' claim ' + short(claimTxid));
		function persistClaimEvidence(txid, alreadyBroadcast) {
			var evidence = $.extend({
				chainCode: chainCode,
				txid: txid || claimTxid,
				txhex: claimTxHex,
				broadcastAt: new Date().toISOString()
			}, extraEvidence || {});
			if (alreadyBroadcast) evidence.alreadyInChain = true;
			saveExecution(session, claimKey, evidence);
			publish(session, messageType, evidence);
			slog(session.swapId, (alreadyBroadcast ? '✓ ' + chainCode + ' claim already known ' : '✓ ' + chainCode + ' claim broadcast ') + evidence.txid);
			return evidence;
		}
		return ENGINE.broadcastTx(chainCode, claimTxHex).then(function (response) {
			return persistClaimEvidence((response && response.txid) || claimTxid, false);
		}, function (error) {
			var message = (error && error.message) ? error.message : String(error || '');
			if (/already in block chain|already in blockchain|already have transaction|txn-already-known|transaction already in block chain/i.test(message)) {
				return persistClaimEvidence(claimTxid, true);
			}
			return $.Deferred().reject(error).promise();
		});
	}

	/* Alice's LTC claim: her own fresh normal signature + Bob's adaptor
	   signature COMPLETED with the adaptor secret y. Broadcasting this is the
	   act that reveals y to Bob (he recovers it from the completed signature
	   in the real transaction). */
	function claimLtcAsAlice(session) {
		if (session.role !== 'alice') throw new Error('Only Alice claims LTC');
		if (!session.adaptorSecret) throw new Error('Adaptor secret unavailable; reopen the wallet that created this swap');
		if (!session.remoteLtcAdaptorSignature) throw new Error('Bob\'s LTC adaptor signature has not arrived yet');
		var tx = claimTxFor(session, 'LTC');
		var aliceSig = ENGINE.signClaimTx('LTC', tx, getLocalChildWif(session, 'LTC'));
		var completedBobSig = ENGINE.completeSig(Crypto.util.hexToBytes(session.remoteLtcAdaptorSignature), session.adaptorSecret);
		return broadcastClaim(session, 'LTC', [aliceSig, completedBobSig], 'ltcClaim', 'swap_ltc_claimed', { completedSigHex: completedBobSig });
	}

	/* Bob's ROD claim: Alice's adaptor signature completed with the RECOVERED
	   secret + his own fresh normal signature. */
	function claimRodAsBob(session) {
		if (session.role !== 'bob') throw new Error('Only Bob claims ROD');
		if (!session.recoveredAdaptorSecret) throw new Error('Adaptor secret has not been recovered from the LTC claim yet');
		if (!session.remoteRodAdaptorSignature) throw new Error('Alice\'s ROD adaptor signature has not arrived yet');
		var tx = claimTxFor(session, 'ROD');
		var bobSig = ENGINE.signClaimTx('ROD', tx, getLocalChildWif(session, 'ROD'));
		var completedAliceSig = ENGINE.completeSig(Crypto.util.hexToBytes(session.remoteRodAdaptorSignature), session.recoveredAdaptorSecret);
		return broadcastClaim(session, 'ROD', [completedAliceSig, bobSig], 'rodClaim', 'swap_rod_claimed', { completedSigHex: completedAliceSig });
	}

	$(document).on('click', '.otcExecBtn', function () {
		var action = $(this).data('action'), session = selectedSwap(), $button = $(this);
		if (!session) { flash('warning', 'Select an active swap first'); return; }
		$button.prop('disabled', true);
		try {
			if (action === 'accept-offer') {
				acceptSession(session, 'Offer accepted by user');
				var liveAcceptedSession = ENGINE.restoreLive(session.swapId) || session;
				flash('success', liveAcceptedSession.remoteAccepted ? 'Offer accepted. Automatic negotiation/funding is running.' : 'Offer accepted. Waiting for counterparty accept.');
				$button.prop('disabled', false);
				return;
			}
			if (action === 'decline-offer') {
				declineSession(session);
				flash('info', 'Offer declined. No automatic funding will be started.');
				$button.prop('disabled', false);
				return;
			}
			if (action === 'claim-ltc') {
				if (session.role !== 'alice') throw new Error('Only Alice claims LTC first');
				slog(session.swapId, '→ Claim LTC requested by seller');
				claimLtcAsAlice(session).then(function (evidence) {
					var liveSession = ENGINE.restoreLive(session.swapId) || session;
					SWAP.safeAdvance(liveSession, 'LTC_CLAIMED', 'LTC claimed');
					ENGINE.saveLive(liveSession);
					showActiveSwap(liveSession.swapId);
					refreshSwaps();
					slog(liveSession.swapId, '→ LTC claimed ' + evidence.txid);
				}).fail(function (error) { flash('warning', error.message || error); }).always(function () { $button.prop('disabled', false); });
				return;
			}
			if (action === 'claim-rod') {
				if (session.role !== 'bob') throw new Error('Only Bob claims ROD after recovering the adaptor secret');
				slog(session.swapId, '→ Claim ROD requested by buyer');
				claimRodAsBob(session).then(function (evidence) {
					var liveSession = ENGINE.restoreLive(session.swapId) || session;
					SWAP.safeAdvance(liveSession, 'ROD_CLAIMED', 'ROD claimed');
					SWAP.safeAdvance(liveSession, 'COMPLETE', 'Swap complete');
					ENGINE.saveLive(liveSession);
					ENGINE.recordTrade(liveSession);
					publish(liveSession, 'swap_complete', { rodClaim: { txid: evidence.txid } });
					showActiveSwap(liveSession.swapId);
					refreshSwaps();
					slog(liveSession.swapId, '✓ COMPLETE ' + evidence.txid);
					refreshHistory();
				}).fail(function (error) { flash('warning', error.message || error); }).always(function () { $button.prop('disabled', false); });
				return;
			}
			if (action === 'attempt-refund') {
				slog(session.swapId, '↻ Manual refund check requested');
				checkRefunds(session);
				$button.prop('disabled', false);
				return;
			}
			if (action === 'refresh') {
				var tasks = [];
				if (session.execution && session.execution.rodFunding && session.execution.rodFunding.txid) tasks.push(verifyFunding(session, 'ROD'));
				if (session.execution && session.execution.ltcFunding && session.execution.ltcFunding.txid) tasks.push(verifyFunding(session, 'LTC'));
				$.when.apply($, tasks).always(function () { var liveSession = ENGINE.restoreLive(session.swapId) || session; slog(session.swapId, '↻ Refreshed funding confirmations'); autoContinueSwap(liveSession); showActiveSwap(session.swapId); $button.prop('disabled', false); });
				return;
			}
		} catch (error) {
			flash(error.message === 'Funding cancelled' ? 'info' : 'danger', error.message || String(error));
			$button.prop('disabled', false);
		}
	});

	/* Auto-fill release height; clear counterparty unless arrived via Take offer */
	$('a[href="#otcNew"]').on('shown.bs.tab', function () {
		checkWallet();
		if (!nsPrefillFromOrder) {
			clearCounterpartyFields();
		} else {
			/* consume one-shot prefill flag after showing fields */
			updateNsModeHint();
			nsPrefillFromOrder = false;
		}
		if (!$('#nsRelease').val()) {
			ENGINE.getRodHeight().then(function (h) {
				var release = h + (ENGINE.loadConfig().releaseBlocks || 20);
				$('#nsRelease').val(release);
				$('#nsHeightHint').text('(current: ' + h + ' + ' + (ENGINE.loadConfig().releaseBlocks || 20) + ')');
			}).fail(function () { $('#nsHeightHint').text('(could not fetch height)'); });
		}
	});

	function randomOrderNameSuffix() {
		var bytes = coinjs.secureRandomBytes ? coinjs.secureRandomBytes(8) : null;
		var hex = '';
		if (bytes && bytes.length) {
			for (var i = 0; i < bytes.length; i++) {
				hex += ('0' + (bytes[i] & 0xff).toString(16)).slice(-2);
			}
		} else {
			hex = Math.abs(Date.now()).toString(16) + Math.floor(Math.random() * 1e8).toString(16);
		}
		return hex;
	}

	function buildOpenOrderPayload() {
		if (!checkWallet()) throw new Error('Open your wallet first');
		if (!swapAcct || !swapAcct.xpub) throw new Error('Swap account not ready — reopen wallet');
		var role = $('#nsRole').val();
		var myAddr = walletId.address;
		var rodAmount = $.trim($('#nsRod').val());
		var ltcAmount = $.trim($('#nsLtc').val());
		var releaseRodHeight = parseInt($('#nsRelease').val(), 10);
		if (!rodAmount || parseFloat(rodAmount) <= 0) throw new Error('Enter a positive ROD amount');
		if (!ltcAmount || parseFloat(ltcAmount) <= 0) throw new Error('Enter a positive LTC amount');
		if (!releaseRodHeight) throw new Error('Set release ROD height');
		var orderId = myAddr + '/otc-order-' + Date.now();
		/* Compact single-line JSON is safer for name_update size limits */
		var payload = {
			version: 1,
			type: 'otc-order',
			side: role === 'alice' ? 'sell' : 'buy',
			seller: role === 'alice' ? myAddr : '',
			buyer: role === 'bob' ? myAddr : '',
			pair: 'ROD/LTC',
			give: rodAmount,
			want: ltcAmount,
			sellerSwapXpub: role === 'alice' ? swapAcct.xpub : '',
			buyerSwapXpub: role === 'bob' ? swapAcct.xpub : '',
			sellerLtcPayoutAddress: role === 'alice' ? getWalletAddressForChain(walletId.wif, 'LTC') : '',
			buyerRodPayoutAddress: role === 'bob' ? getWalletAddressForChain(walletId.wif, 'ROD') : '',
			releaseRodHeight: releaseRodHeight,
			orderId: orderId
		};
		var serialized = JSON.stringify(payload);
		if (serialized.length > 1023) {
			throw new Error('Order JSON is ' + serialized.length + ' chars — may exceed name value limit. Shorten fields.');
		}
		payload._bytes = serialized.length;
		return payload;
	}

	function addNameToScanList(name) {
		/* Orderbook now auto-scans ^d/otc-swap/ via name_scan; keep last name for UX only */
		var n = $.trim(name || '');
		if (n) localStorage.setItem('otcLastOrderName', n);
	}

	$('#nsOrderNameGen').on('click', function () {
		$('#nsOrderName').val('d/otc-swap/' + randomOrderNameSuffix());
	});

	/* Create open order and publish full JSON to ROD name DB via Core RPC */
	$('#nsCreateOrder').on('click', function () {
		var $btn = $('#nsCreateOrder');
		try {
			var payload = buildOpenOrderPayload();
			var bytes = payload._bytes;
			delete payload._bytes;
			var name = $.trim($('#nsOrderName').val());
			if (!name) {
				name = 'd/otc-swap/' + randomOrderNameSuffix();
				$('#nsOrderName').val(name);
			}
			$('#nsSwapId').val('');
			$('#nsOffer').val(JSON.stringify(payload, null, 2));
			$('#nsPublishStatus').text('Checking wallet balance…');
			$btn.prop('disabled', true);
			ensureWalletFundsForRole($('#nsRole').val(), payload.give, payload.want).then(function () {
				$('#nsPublishStatus').text('Publishing to ROD name DB…');
				return ENGINE.namePublish(name, payload);
			}).then(function (res) {
				localStorage.setItem('otcLastOrderName', res.name);
				addNameToScanList(res.name);
				var tx = res.txid || '';
				var net = (coinjs.getNetwork && coinjs.getNetwork()) || {};
				var explorer = (net.explorer && net.explorer.tx) || 'https://explorer.rod.spacexpanse.org/tx/';
				$('#nsPublishStatus').html(
					'Published via <b>name_' + esc(res.action) + '</b> to <code>' + esc(res.name) + '</code>' +
					(tx ? (' · txid <a href="' + esc(explorer + tx) + '" target="_blank">' + esc(short(tx)) + '</a>') : '')
				);
				flash('success', 'Order written to ROD DB (' + res.action + '): ' + res.name + (tx ? ' · ' + tx : ''));
				log('Published order → ' + res.name + ' (' + res.action + ', ' + bytes + ' bytes)' + (tx ? ' tx=' + tx : ''));
				/* Name may need a confirmation before name_show returns the new value */
				setTimeout(function () { refreshBook(); }, 2000);
			}, function (err) {
				var msg = '';
				if (typeof err === 'string') msg = err;
				else if (err && err.message) msg = err.message;
				else if (err && err.error && err.error.message) msg = err.error.message;
				else try { msg = JSON.stringify(err); } catch (e2) { msg = String(err); }
				if (/passphrase|encrypted|unlocked/i.test(msg)) {
					msg += ' — unlock the wallet in ROD Core (walletpassphrase) first.';
				}
				$('#nsPublishStatus').html('<span style="color:#f1334a">Publish failed: ' + esc(msg) + '</span>');
				flash('danger', 'Publish failed: ' + msg);
				log('Publish failed for ' + name + ': ' + msg);
			}).always(function () {
				$btn.prop('disabled', false);
			});
		} catch (e) {
			$btn.prop('disabled', false);
			flash('danger', (e && e.message) ? e.message : String(e));
		}
	});

	/* Start bilateral swap — requires counterparty (manual or from Dashboard Take) */
	$('#nsCreate').on('click', function () {
		var $btn = $('#nsCreate');
		try {
			if (!checkWallet()) throw new Error('Open your wallet first');
			if (!swapAcct || !swapAcct.xprv || !swapAcct.xpub) throw new Error('Swap account not ready — reopen wallet');
			var role = $('#nsRole').val(), peer = $.trim($('#nsPeer').val()), peerXpub = $.trim($('#nsPeerXpub').val()), peerPayoutAddress = $.trim($('#nsPeerPayoutAddr').val());
			if (!peer) throw new Error('Enter counterparty identity, or Take an order on the Dashboard first');
			if (!peerXpub) throw new Error('Enter counterparty swap xpub, or Take an order on the Dashboard first');
			if (!peerPayoutAddress) throw new Error('Enter counterparty payout address, or Take an order on the Dashboard first');
			if (peerXpub === swapAcct.xpub) throw new Error('Counterparty xpub must differ from your swap xpub');

			/* Dust-limit validation: both the funding output AND the claim
			   output (funding minus fee) must exceed the network dust
			   threshold — otherwise the tx will be rejected by nodes. */
			var DUST_LIMIT = 546; /* satoshis — applies to both ROD and LTC P2SH outputs */
			var rodSats = CHAINS.decimalToSats($('#nsRod').val());
			var ltcSats = CHAINS.decimalToSats($('#nsLtc').val());
			var rodClaimFeeSats = CHAINS.decimalToSats(claimFee('ROD'));
			var ltcClaimFeeSats = CHAINS.decimalToSats(claimFee('LTC'));
			if (rodSats < DUST_LIMIT) throw new Error('ROD amount (' + rodSats + ' sats) is below dust limit (' + DUST_LIMIT + ' sats). Minimum: ' + CHAINS.satsToDecimal(DUST_LIMIT) + ' ROD');
			if (ltcSats < DUST_LIMIT) throw new Error('LTC amount (' + ltcSats + ' sats) is below dust limit (' + DUST_LIMIT + ' sats). Minimum: ' + CHAINS.satsToDecimal(DUST_LIMIT) + ' LTC');
			if (rodSats - rodClaimFeeSats < DUST_LIMIT) throw new Error('ROD claim output (' + (rodSats - rodClaimFeeSats) + ' sats) would be dust after fee. Increase ROD amount.');
			if (ltcSats - ltcClaimFeeSats < DUST_LIMIT) throw new Error('LTC claim output (' + (ltcSats - ltcClaimFeeSats) + ' sats) would be dust after fee. Increase LTC amount.');

			$btn.prop('disabled', true);
			flash('info', 'Checking wallet balance…');

			$.when(
				ensureWalletFundsForRole(role, $('#nsRod').val(), $('#nsLtc').val()),
				ENGINE.getRodHeight(),
				ENGINE.getLtcHeight()
			).then(function (balanceProof, rodHeight, ltcHeight) {
				try {
				var cfgNow = ENGINE.loadConfig();
				var myAddr = walletId.address;
				var orderId = (role === 'alice' ? myAddr : peer) + '/otc-' + Date.now();
				var sellerIdentity = role === 'alice' ? myAddr : peer;
				var buyerIdentity = role === 'bob' ? myAddr : peer;
				var termsNonce = randomOrderNameSuffix() + randomOrderNameSuffix();
				var swapId = SWAP.swapIdFromOrder(orderId, '1', sellerIdentity, buyerIdentity, termsNonce);
				var localRodAddress = getWalletAddressForChain(walletId.wif, 'ROD');
				var localLtcAddress = getWalletAddressForChain(walletId.wif, 'LTC');
				var sellerLtcPayoutAddress = role === 'alice' ? localLtcAddress : peerPayoutAddress;
				var buyerRodPayoutAddress = role === 'bob' ? localRodAddress : peerPayoutAddress;
				/* Refund locks: Alice (secret holder) refunds LATE on ROD, Bob
				   refunds EARLY on LTC — enforced by native locktimes. */
				var refundRodHeight = parseInt(rodHeight, 10) + (parseInt(cfgNow.refundRodBlocks, 10) || 480);
				var ltcRefundLockHeight = parseInt(ltcHeight, 10) + (parseInt(cfgNow.ltcRefundBlocks, 10) || 24);
				var releaseRodHeight = parseInt($('#nsRelease').val(), 10);
				if (releaseRodHeight >= refundRodHeight) {
					throw new Error('Release height ' + releaseRodHeight + ' must be below the ROD refund height ' + refundRodHeight);
				}

				var session = SWAP.createOfferSession({
					role: role, swapId: swapId, orderId: orderId,
					rodAmount: $('#nsRod').val(), ltcAmount: $('#nsLtc').val(),
					releaseRodHeight: $('#nsRelease').val(),
					sellerSwapAccountKey: role === 'alice' ? swapAcct.xprv : peerXpub,
					buyerSwapAccountKey: role === 'alice' ? peerXpub : swapAcct.xprv,
					sellerLtcPayoutAddress: sellerLtcPayoutAddress,
					buyerRodPayoutAddress: buyerRodPayoutAddress,
					sellerIdentity: sellerIdentity,
					buyerIdentity: buyerIdentity,
					termsNonce: termsNonce,
					refundRodHeight: refundRodHeight,
					ltcRefundLockHeight: ltcRefundLockHeight,
					rodConfirmations: parseInt(cfgNow.rodConfirmations, 10) || 1,
					ltcConfirmations: parseInt(cfgNow.ltcConfirmations, 10) || 1
				});

				session.readiness = session.readiness || {};
				session.readiness.local = buildReadinessEvidence(balanceProof);

				if (role === 'alice') {
					var y = coinjs.adaptor.generateSecret();
					session.adaptorSecret = y;
					session.adaptorPoint = coinjs.adaptor.publicKey(y);
				}
				session.localNostrPubkey = NOSTR.identityFromWif(walletId.wif).pubkey || '';
				session.localNostrPrivateKey = walletId.nostrPrivateKey || NOSTR.identityFromWif(walletId.wif).privateKeyHex || '';

				ENGINE.saveLive(session);

				/* Auto-negotiate terms and readiness only; user accept/decline controls funding start. */
				SWAP.advanceState(session, 'NEGOTIATING', 'Terms sent');
				if (ENGINE.pool) {
					ENGINE.publishSwapMessage(session, 'swap_terms', { terms: session.terms });
					if (session.adaptorPoint) ENGINE.publishSwapMessage(session, 'swap_adaptor_point', { adaptorPoint: session.adaptorPoint });
					ENGINE.publishSwapMessage(session, 'swap_ready', { readiness: session.readiness.local });
					slog(session.swapId, '→ Sent terms + readiness via Nostr');
				}
				markBilateralReady(session);
				ENGINE.saveLive(session);

				$('#nsSwapId').val(session.swapId);
				$('#nsOffer').val(JSON.stringify({
					version: 1, type: 'otc-order', seller: role === 'alice' ? myAddr : peer,
					buyer: role === 'bob' ? myAddr : peer,
					pair: 'ROD/LTC', give: session.terms.rodAmount, want: session.terms.ltcAmount,
					sellerSwapXpub: session.sellerSwapXpub, buyerSwapXpub: session.buyerSwapXpub,
					sellerLtcPayoutAddress: session.terms.sellerLtcPayoutAddress,
					buyerRodPayoutAddress: session.terms.buyerRodPayoutAddress,
					releaseRodHeight: session.terms.releaseRodHeight,
					termsHash: session.terms.termsHash
				}, null, 2));

				/* Clear counterparty after successful start so next visit is a clean order form */
				clearCounterpartyFields();
				refreshSwaps();
				flash('success', 'Swap created: ' + short(swapId) + '. Review details, then accept or decline.');
				} catch (createError) {
					flash('danger', (createError && createError.message) ? createError.message : String(createError));
				}
			}, function (error) {
				flash('danger', (error && error.message) ? error.message : String(error));
			}).always(function () {
				$btn.prop('disabled', false);
			});
		} catch (e) {
			$btn.prop('disabled', false);
			flash('danger', (e && e.message) ? e.message : String(e));
		}
	});

	updateNsModeHint();

	/* ============ AUTO-NEGOTIATION ============ */
	function slog(id, msg) {
		var all = ENGINE.loadLive(), s = all[id]; if (!s) return;
		s._log = s._log || [];
		s._log.push('[' + ts() + '] ' + msg);
		if (s._log.length > 80) s._log = s._log.slice(-80);
		all[id] = s; localStorage.setItem('rodOtcLive', JSON.stringify(all));
		log(msg);
	}

	function localRoleFromTerms(terms) {
		if (!checkWallet() || !swapAcct || !swapAcct.xprv || !swapAcct.xpub || !terms) return '';
		if (ENGINE.sameExtendedKey(terms.sellerSwapXpub, swapAcct.xpub)) return 'alice';
		if (ENGINE.sameExtendedKey(terms.buyerSwapXpub, swapAcct.xpub)) return 'bob';
		return '';
	}

	function createIncomingTermsSession(env, eventObject) {
		var p = env.payload || {}, terms = p.terms;
		if (env.type !== 'swap_terms' || !terms) {
			if (ENGINE.trackedSwapIds && ENGINE.trackedSwapIds[env.swapId]) log('Tracked ' + short(env.swapId) + ' ignored until swap_terms arrives; got ' + env.type);
			return null;
		}
		var all = ENGINE.loadLive();
		if (all[env.swapId]) return ENGINE.restoreLive(env.swapId) || all[env.swapId];
		var role = localRoleFromTerms(terms);
		if (!role) {
			log('Incoming terms role mismatch ' + short(env.swapId) + ': local xpub ' + short(swapAcct && swapAcct.xpub || '') + ' seller ' + short(terms.sellerSwapXpub || '') + ' buyer ' + short(terms.buyerSwapXpub || ''));
			return null;
		}
		try {
			/* Bind the swap ID to the 5-field hash so a peer cannot reuse
			   terms under a different identity or replay an old session. */
			if (terms.termsNonce) {
				var expectedSwapId = SWAP.swapIdFromOrder(terms.orderId, '1', terms.sellerIdentity, terms.buyerIdentity, terms.termsNonce);
				if (expectedSwapId !== env.swapId) {
					throw new Error('Incoming swapId does not match SHA256(orderId|rev|seller|buyer|nonce)');
				}
			}
			/* Refund-safety sanity checks before a session is even created */
			if (!(parseInt(terms.refundRodHeight, 10) > parseInt(terms.releaseRodHeight, 10))) {
				throw new Error('Incoming terms rejected: refundRodHeight must be above releaseRodHeight');
			}
			if (!(parseInt(terms.ltcRefundLockHeight, 10) > 0)) {
				throw new Error('Incoming terms rejected: missing LTC refund lock height');
			}
			var session = SWAP.createOfferSession({
				role: role,
				swapId: env.swapId,
				orderId: terms.orderId,
				rodAmount: terms.rodAmount,
				ltcAmount: terms.ltcAmount,
				releaseRodHeight: terms.releaseRodHeight,
				sellerSwapAccountKey: role === 'alice' ? swapAcct.xprv : terms.sellerSwapXpub,
				buyerSwapAccountKey: role === 'bob' ? swapAcct.xprv : terms.buyerSwapXpub,
				sellerLtcPayoutAddress: terms.sellerLtcPayoutAddress,
				buyerRodPayoutAddress: terms.buyerRodPayoutAddress,
				sellerIdentity: terms.sellerIdentity,
				buyerIdentity: terms.buyerIdentity,
				termsNonce: terms.termsNonce,
				refundRodHeight: terms.refundRodHeight,
				ltcRefundLockHeight: terms.ltcRefundLockHeight,
				rodConfirmations: terms.rodConfirmations,
				ltcConfirmations: terms.ltcConfirmations,
				rodClaimFee: terms.rodClaimFee,
				ltcClaimFee: terms.ltcClaimFee,
				rodRefundFee: terms.rodRefundFee,
				ltcRefundFee: terms.ltcRefundFee
			});
			if (!session.terms || session.terms.termsHash !== terms.termsHash) {
				var expectedLocalPubkey = role === 'alice' ? terms.aliceChildPubKey : terms.bobChildPubKey;
				var localPubkeyMatches = !!(expectedLocalPubkey && session.localChildPublicKey === expectedLocalPubkey);
				log('Incoming terms hash mismatch ' + short(env.swapId) + ': local ' + short(session.terms && session.terms.termsHash || '') + ' remote ' + short(terms.termsHash || '') + ' localPubkeyMatches=' + localPubkeyMatches);
				if (!localPubkeyMatches) {
					ENGINE.removeLive(env.swapId);
					log('Incoming terms local key mismatch ' + short(env.swapId) + ': role ' + role + ' local child ' + short(session.localChildPublicKey || '') + ' expected ' + short(expectedLocalPubkey || ''));
					throw new Error('Incoming swap terms do not match locally derived terms hash');
				}
				session.terms = $.extend(true, {}, terms);
				session.sellerSwapXpub = terms.sellerSwapXpub;
				session.buyerSwapXpub = terms.buyerSwapXpub;
				session.childIndex = terms.childIndex;
				log('Accepted incoming remote terms after local key match ' + short(env.swapId));
			}
			if (eventObject) {
				ensureRemotePeer(session, eventObject);
				try { SWAP.addMessage(env.swapId, eventObject); } catch (messageError) {}
			}
			/* Alice must generate the adaptor secret when receiving
			   incoming terms, just as she does in the Create button path.
			   Without this, the adaptor point is never published and the
			   swap deadlocks after refund exchange. */
			if (role === 'alice') {
				var y = coinjs.adaptor.generateSecret();
				session.adaptorSecret = y;
				session.adaptorPoint = coinjs.adaptor.publicKey(y);
			}
			session.localNostrPubkey = NOSTR.identityFromWif(walletId.wif).pubkey || '';
			session.localNostrPrivateKey = walletId.nostrPrivateKey || NOSTR.identityFromWif(walletId.wif).privateKeyHex || '';
			SWAP.safeAdvance(session, 'NEGOTIATING', 'Incoming terms received');
			ENGINE.saveLive(session);
			/* Publish adaptor point immediately so Bob receives it via relay */
			if (session.adaptorPoint) {
				publish(session, 'swap_adaptor_point', { adaptorPoint: session.adaptorPoint });
				slog(env.swapId, '→ Adaptor point published (incoming session)');
			}
			$('#otcTrackSwapStatus').html('Added <code>' + esc(short(env.swapId)) + '</code> from incoming terms.');
			slog(env.swapId, '← Created incoming ' + (role === 'alice' ? 'seller' : 'buyer') + ' session from terms');
			ensureWalletFundsForRole(role, terms.rodAmount, terms.ltcAmount).then(function (balanceProof) {
				saveLocalReadiness(session, buildReadinessEvidence(balanceProof), '→ Sent local readiness proof');
			}, function (error) {
				var fallbackReadiness = buildLocalReadinessUnchecked(role, terms.rodAmount, terms.ltcAmount, 'Balance check blocked: ' + error);
				saveLocalReadiness(session, fallbackReadiness, '⚠ Sent unverified local readiness after balance check failed: ' + error);
				flash('warning', 'Readiness sent without balance verification: ' + error);
			});
			return session;
		} catch (error) {
			log('Incoming terms rejected ' + short(env.swapId) + ': ' + (error.message || error));
			flash('warning', 'Incoming swap terms rejected: ' + (error.message || error));
			return null;
		}
	}

	function autoProcess(env, eventObject) {
		if (ENGINE.trackedSwapIds && ENGINE.trackedSwapIds[env.swapId]) {
			$('#otcTrackSwapStatus').html('Heard <code>' + esc(short(env.swapId)) + '</code> event type <code>' + esc(env.type) + '</code>.');
		}
		var all = ENGINE.loadLive(), sess = all[env.swapId] || createIncomingTermsSession(env, eventObject); if (!sess) return;
		/* Decrypt keys */
		var pw = ENGINE.walletPassword();
		if (sess._ep && pw) { try { sess.localChildPrivateKey = CryptoJS.AES.decrypt(sess._ep, pw).toString(CryptoJS.enc.Utf8); } catch (e) {} }
		if (sess._ea && pw) { try { sess.adaptorSecret = CryptoJS.AES.decrypt(sess._ea, pw).toString(CryptoJS.enc.Utf8); } catch (e) {} }
		if (sess._en && pw) { try { sess.localNostrPrivateKey = CryptoJS.AES.decrypt(sess._en, pw).toString(CryptoJS.enc.Utf8); } catch (e) {} }
		var p = env.payload || {};

		if (env.type === 'swap_adaptor_point' && p.adaptorPoint) {
			sess.adaptorPoint = p.adaptorPoint;
			slog(env.swapId, '← Adaptor point received');
			ENGINE.saveLive(sess);
		}
		if (env.type === 'swap_ready' && p.readiness) {
			try { ensureRemotePeer(sess, eventObject); } catch (peerError0) { slog(env.swapId, peerError0.message || peerError0); return; }
			sess.readiness = sess.readiness || {};
			sess.readiness.remote = p.readiness;
			slog(env.swapId, '← Remote readiness proof received');
			markBilateralReady(sess);
			ENGINE.saveLive(sess);
			refreshSwaps();
			autoContinueSwap(sess);
		}
		if (env.type === 'swap_accept') {
			try { ensureRemotePeer(sess, eventObject); } catch (peerError1) { slog(env.swapId, peerError1.message || peerError1); return; }
			sess.remoteAccepted = true;
			if (sess.localAccepted) SWAP.safeAdvance(sess, 'TERMS_ACCEPTED', 'Both peers accepted offer');
			slog(env.swapId, '← Counterparty accepted offer');
			ENGINE.saveLive(sess);
			refreshSwaps();
			autoContinueSwap(sess);
		}
		if (env.type === 'swap_decline') {
			try { ensureRemotePeer(sess, eventObject); } catch (peerError2) { slog(env.swapId, peerError2.message || peerError2); return; }
			sess.declined = true;
			sess.declinedAt = new Date().toISOString();
			slog(env.swapId, '← Counterparty declined offer');
			ENGINE.saveLive(sess);
			refreshSwaps();
		}
		/* --- Pre-funding protocol messages --- */
		if (env.type === 'swap_rod_funding_planned' && p.txid && !isLocalEcho(sess, eventObject)) {
			try { ensureRemotePeer(sess, eventObject); } catch (peerErrorP1) { slog(env.swapId, peerErrorP1.message || peerErrorP1); return; }
			if (sess.role === 'bob' && !(sess.plannedRodFunding && sess.plannedRodFunding.txid)) {
				sess.plannedRodFunding = { txid: p.txid, vout: p.vout || 0, value: p.value, amount: p.amount };
				slog(env.swapId, '← Alice planned ROD funding ' + short(p.txid) + ' (not yet broadcast)');
				ENGINE.saveLive(sess);
				autoContinueSwap(sess);
			}
		}
		if (env.type === 'swap_ltc_funding_planned' && p.txid && !isLocalEcho(sess, eventObject)) {
			try { ensureRemotePeer(sess, eventObject); } catch (peerErrorP2) { slog(env.swapId, peerErrorP2.message || peerErrorP2); return; }
			if (sess.role === 'alice' && !(sess.plannedLtcFunding && sess.plannedLtcFunding.txid)) {
				sess.plannedLtcFunding = { txid: p.txid, vout: p.vout || 0, value: p.value, amount: p.amount };
				slog(env.swapId, '← Bob planned LTC funding ' + short(p.txid) + ' (not yet broadcast)');
				ENGINE.saveLive(sess);
				autoContinueSwap(sess);
			}
		}
		/* Refund signature exchange and adaptor signatures are ORDER-SENSITIVE
		   (they need the planned-funding announcement first). Payloads are
		   stashed in pending slots and consumed by processPendingProtocol(),
		   which runs both here and from the automation tick, so out-of-order
		   relay delivery can never deadlock the handshake. The receiving side
		   always rebuilds the refund/claim TEMPLATE ITSELF from canonical
		   terms + the planned outpoint and verifies against that self-built
		   sighash — nothing signed here is taken on trust from the wire. */
		if (env.type === 'swap_rod_refund_signature' && p.signature && !isLocalEcho(sess, eventObject)) {
			try { ensureRemotePeer(sess, eventObject); } catch (peerErrorR1) { slog(env.swapId, peerErrorR1.message || peerErrorR1); return; }
			if (sess.role === 'bob' && p.from === 'alice' && !sess.rodRefundCosigned) {
				sess._pendingRodRefundSig = p.signature;
				ENGINE.saveLive(sess);
				autoContinueSwap(sess);
			}
			if (sess.role === 'alice' && p.from === 'bob' && sess.rodRefund && sess.rodRefund.localSig && !sess.rodRefund.signedHex) {
				sess._pendingRodRefundCosig = p.signature;
				ENGINE.saveLive(sess);
				autoContinueSwap(sess);
			}
		}
		if (env.type === 'swap_ltc_refund_signature' && p.signature && !isLocalEcho(sess, eventObject)) {
			try { ensureRemotePeer(sess, eventObject); } catch (peerErrorR2) { slog(env.swapId, peerErrorR2.message || peerErrorR2); return; }
			if (sess.role === 'alice' && p.from === 'bob' && !sess.ltcRefundCosigned) {
				sess._pendingLtcRefundSig = p.signature;
				ENGINE.saveLive(sess);
				autoContinueSwap(sess);
			}
			if (sess.role === 'bob' && p.from === 'alice' && sess.ltcRefund && sess.ltcRefund.localSig && !sess.ltcRefund.signedHex) {
				sess._pendingLtcRefundCosig = p.signature;
				ENGINE.saveLive(sess);
				autoContinueSwap(sess);
			}
		}
		if (env.type === 'swap_ltc_adaptor_signature' && p.hex && !isLocalEcho(sess, eventObject)) {
			if (sess.role === 'alice' && !sess.remoteLtcAdaptorSignature) {
				sess._pendingLtcAdaptorSig = p.hex;
				ENGINE.saveLive(sess);
				autoContinueSwap(sess);
			}
		}
		if (env.type === 'swap_rod_adaptor_signature' && p.hex && !isLocalEcho(sess, eventObject)) {
			if (sess.role === 'bob' && !sess.remoteRodAdaptorSignature) {
				sess._pendingRodAdaptorSig = p.hex;
				ENGINE.saveLive(sess);
				autoContinueSwap(sess);
			}
		}
		if (env.type === 'swap_prepared' && !isLocalEcho(sess, eventObject)) {
			try { ensureRemotePeer(sess, eventObject); } catch (peerErrorP3) { slog(env.swapId, peerErrorP3.message || peerErrorP3); return; }
			sess.remotePrepared = true;
			slog(env.swapId, '← Counterparty PREPARED');
			ENGINE.saveLive(sess);
			autoContinueSwap(sess);
		}
		if (env.type === 'swap_rod_funded' && p.funding) {
			try { ensureRemotePeer(sess, eventObject); } catch (peerError3) { slog(env.swapId, peerError3.message || peerError3); return; }
			/* Gate: on-chain funding evidence must match the PLANNED txid the
			   refunds and adaptor signatures were built against. */
			if (sess.plannedRodFunding && p.funding.txid && p.funding.txid !== sess.plannedRodFunding.txid) {
				slog(env.swapId, '✗ ROD funding evidence txid does not match planned funding — ignored');
			} else {
				/* Merge (not replace) so locally-derived fields survive, and strip
				   verifiedLocally: remote claims are never local verification. */
				var rodEvidence = $.extend({}, p.funding); delete rodEvidence.verifiedLocally;
				sess.execution = sess.execution || {};
				sess.execution.rodFunding = $.extend({}, sess.execution.rodFunding || {}, rodEvidence);
				try { SWAP.safeAdvance(sess, 'ALICE_ROD_FUNDED', 'Remote ROD funding evidence'); } catch (e1) {}
				slog(env.swapId, '← ROD funding evidence'); ENGINE.saveLive(sess);
				autoContinueSwap(sess);
			}
		}
		if (env.type === 'swap_ltc_funded' && p.funding) {
			try { ensureRemotePeer(sess, eventObject); } catch (peerError4) { slog(env.swapId, peerError4.message || peerError4); return; }
			if (sess.plannedLtcFunding && p.funding.txid && p.funding.txid !== sess.plannedLtcFunding.txid) {
				slog(env.swapId, '✗ LTC funding evidence txid does not match planned funding — ignored');
			} else {
				var ltcEvidence = $.extend({}, p.funding); delete ltcEvidence.verifiedLocally;
				sess.execution = sess.execution || {};
				sess.execution.ltcFunding = $.extend({}, sess.execution.ltcFunding || {}, ltcEvidence);
				try { SWAP.safeAdvance(sess, 'BOB_LTC_FUNDED', 'Remote LTC funding evidence'); } catch (e2) {}
				slog(env.swapId, '← LTC funding evidence'); ENGINE.saveLive(sess);
				autoContinueSwap(sess);
			}
		}
		if (env.type === 'swap_ltc_claimed' && !isLocalEcho(sess, eventObject)) {
			sess.execution = sess.execution || {};
			sess.execution.ltcClaim = $.extend({}, sess.execution.ltcClaim || {}, p);
			try { SWAP.safeAdvance(sess, 'LTC_CLAIMED', 'Remote LTC claim evidence'); } catch (e3) {}
			slog(env.swapId, '← LTC claimed evidence'); ENGINE.saveLive(sess);
			if (sess.role === 'bob') {
				if (tryRecoverFromEvidence(sess)) autoContinueSwap(ENGINE.restoreLive(sess.swapId) || sess);
				else autoContinueSwap(sess);
			}
		}
		if (env.type === 'swap_rod_refund_broadcast' && !isLocalEcho(sess, eventObject)) {
			sess.execution = sess.execution || {};
			sess.execution.rodRefund = $.extend({}, sess.execution.rodRefund || {}, { txid: p.txid || '' });
			try {
				var ltcClaimedByAlice = !!(sess.execution.ltcClaim && sess.execution.ltcClaim.txid);
				SWAP.markRefundState(sess, ltcClaimedByAlice ? 'PARTIALLY_SETTLED' : (sess.state === 'LTC_REFUNDED' ? 'REFUNDED' : 'ROD_REFUNDED'), 'Counterparty broadcast ROD refund');
			} catch (refundStateError1) {}
			slog(env.swapId, '← ROD refund broadcast by counterparty'); ENGINE.saveLive(sess);
			refreshSwaps();
		}
		if (env.type === 'swap_ltc_refund_broadcast' && !isLocalEcho(sess, eventObject)) {
			sess.execution = sess.execution || {};
			sess.execution.ltcRefund = $.extend({}, sess.execution.ltcRefund || {}, { txid: p.txid || '' });
			try {
				SWAP.markRefundState(sess, (sess.state === 'ROD_REFUNDED' || sess.state === 'REFUNDED') ? 'REFUNDED' : 'LTC_REFUNDED', 'Counterparty broadcast LTC refund');
			} catch (refundStateError2) {}
			slog(env.swapId, '← LTC refund broadcast by counterparty'); ENGINE.saveLive(sess);
			refreshSwaps();
		}
		if (env.type === 'swap_refunded' && !isLocalEcho(sess, eventObject)) {
			try { SWAP.markRefundState(sess, 'REFUNDED', 'Counterparty reported swap refunded'); } catch (refundStateError3) {}
			slog(env.swapId, '← Swap refunded'); ENGINE.saveLive(sess);
			refreshSwaps();
		}
		if (env.type === 'swap_secret_recovered' && !isLocalEcho(sess, eventObject)) {
			try { SWAP.safeAdvance(sess, 'SECRET_RECOVERED', 'Remote secret recovery evidence'); } catch (e4) {}
			slog(env.swapId, '← Secret recovery evidence'); ENGINE.saveLive(sess);
		}
		if (env.type === 'swap_rod_claimed' && !isLocalEcho(sess, eventObject)) {
			sess.execution = sess.execution || {}; sess.execution.rodClaim = p;
			try { SWAP.safeAdvance(sess, 'ROD_CLAIMED', 'Remote ROD claim evidence'); } catch (e5) {}
			slog(env.swapId, '← ROD claimed evidence'); ENGINE.saveLive(sess);
		}
		if (env.type === 'swap_complete' && !isLocalEcho(sess, eventObject)) {
			sess.state = 'COMPLETE'; ENGINE.saveLive(sess);
			ENGINE.recordTrade(sess);
			slog(env.swapId, '✓ COMPLETE');
			refreshHistory();
		}
		showActiveSwap(sess.swapId);
		refreshSwaps();
	}

	/* ============ HISTORY ============ */
	function refreshHistory() {
		var h = ENGINE.getHistory();
		$('#otcHistBody').html(h.map(function (t) {
			return '<tr><td>' + esc((t.completedAt || '').slice(0, 16)) + '</td><td><code>' + esc(short(t.swapId)) + '</code></td><td>' + esc(t.role) + '</td><td>' + esc(t.rodAmount) + '</td><td>' + esc(t.ltcAmount) + '</td><td><span class="label label-' + (t.state === 'COMPLETE' ? 'success' : 'default') + '">' + esc(t.state) + '</span></td></tr>';
		}).join('') || '<tr><td colspan="6" class="text-muted">No trades yet.</td></tr>');
	}
	$('#otcClearHist').on('click', function () { ENGINE.clearHistory(); refreshHistory(); });
	refreshHistory();

	/* ============ SETTINGS ============ */
	$('#cfgSaveApi').on('click', function () {
		var c = ENGINE.loadConfig();
		var def = ENGINE.defaults || {};
		c.rodApiUrl = $.trim($('#cfgRodApi').val()) || def.rodApiUrl || 'https://api.spacexpanse.org:1234';
		c.ltcApiUrl = $.trim($('#cfgLtcApi').val()) || def.ltcApiUrl || 'https://litecoinspace.org/api';
		c.relays = $('#cfgRelays').val().split('\n').map($.trim).filter(Boolean);
		if (!c.relays.length) {
			c.relays = (ENGINE.DEFAULT_RELAYS || def.relays || []).slice();
			$('#cfgRelays').val(c.relays.join('\n'));
		}
		ENGINE.saveConfig(c);
		/* Apply new relay list immediately (old pool ignored post-save before). */
		startNostr(true);
		log('Relays updated: ' + c.relays.join(', '));
		flash('success', 'API & relay settings saved — reconnecting to ' + c.relays.length + ' relay(s).');
		refreshRelayStatus();
	});
	$('#cfgSaveRpc').on('click', function () {
		var c = ENGINE.loadConfig();
		c.rpcUrl = $.trim($('#cfgRpcUrl').val()); c.rpcPort = $.trim($('#cfgRpcPort').val()) || '11999';
		c.rpcUser = $.trim($('#cfgRpcUser').val()); c.rpcPass = $('#cfgRpcPass').val();
		c.rpcWallet = $.trim($('#cfgRpcWallet').val());
		var ep = c.rpcUrl ? ENGINE.buildRpcEndpoint(c) : null;
		if (ep && ep.user && !c.rpcUser) {
			c.rpcUser = ep.user; c.rpcPass = ep.pass;
			$('#cfgRpcUser').val(ep.user); $('#cfgRpcPass').val(ep.pass);
		}
		// Do not point the browser name-helper at raw Core RPC (not CORS-safe).
		ENGINE.saveConfig(c);
		updateRpcEndpointHint();
		flash('success', 'RPC settings saved locally' + (ep ? ' → ' + ep.url : '') + '.');
		refreshRpcStatus();
	});
	$('#cfgRunTests').on('click', function () {
		var r = rodOtc.validation.runAll();
		$('#cfgTestR').html(r.passed ? '<span style="color:#62e6a6">All passed ✓</span>' : '<span style="color:#f1334a">Failed ✗</span>');
	});
	$('#cfgExport').on('click', function () { $('#cfgBackup').val(STORAGE.exportState()); });
	$('#cfgImport').on('click', function () {
		try { STORAGE.importState($('#cfgBackup').val()); refreshSwaps(); flash('success', 'Imported.'); } catch (e) { flash('danger', e.message); }
	});

	/* ============ INIT ============ */
	/* Automation locks are per-attempt, not durable state: clear any that a
	   previous page run left behind, then resume automation for every live
	   session so a reload never strands a swap mid-flow. */
	(function resumeAfterReload() {
		var all = ENGINE.loadLive(), changed = false;
		for (var id in all) {
			if (all[id] && all[id].automation) { delete all[id].automation; changed = true; }
		}
		if (changed) localStorage.setItem('rodOtcLive', JSON.stringify(all));
		setTimeout(function () {
			var sessions = ENGINE.loadLive();
			for (var swapId in sessions) {
				var restored = ENGINE.restoreLive(swapId);
				if (restored && !isTerminal(restored)) {
					try { autoContinueSwap(restored); } catch (e) { log('Resume failed for ' + short(swapId) + ': ' + (e.message || e)); }
				}
			}
		}, 4000); /* give relays time to connect first */
	})();
	startNostr();
	refreshConnStatus();
	/* Liveness tick: automation used to advance only on incoming Nostr events
	   or manual refresh, so one failed verify (e.g. API 404 right after
	   broadcast) stranded the swap. Re-drive every live session periodically;
	   markAutomationBusy() locks keep this idempotent and non-overlapping.
	   The tick also runs the refund monitor, so a disappeared counterparty
	   leads to an automatic timelocked refund instead of stranded funds. */
	setInterval(function () {
		var liveSessions = ENGINE.loadLive();
		for (var liveSwapId in liveSessions) {
			var liveSession = ENGINE.restoreLive(liveSwapId);
			if (liveSession && !isTerminal(liveSession)) {
				try { autoContinueSwap(liveSession); } catch (tickError) {}
			}
		}
	}, parseInt(ENGINE.loadConfig().tickMs, 10) || 30000);
	setInterval(function () {
		if ($('#otc').is(':visible')) refreshRelayStatus();
	}, 5000);
	setInterval(function () {
		if ($('#otc').is(':visible')) refreshRpcStatus();
	}, 30000);
	refreshSwaps();
	log('OTC swap app ready — Nostr connecting automatically');
});
