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
		'<div class="col-md-8"><div class="otc-panel"><h5>Active swaps</h5><div id="otcSwapList"></div></div></div>',
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
		'<div class="alert alert-warning" style="font-size:12px;margin-bottom:8px"><b>Safety:</b> MVP funding uses deterministic 2-of-2 multisig without an automated refund path. Broadcasting funding can strand funds if the counterparty disappears.</div>',
		'<div class="row"><div class="col-md-6">',
		'<label>Funding fee</label><input id="otcExecFundingFee" class="form-control" value="0.00001000">',
		'<label>Claim fee</label><input id="otcExecClaimFee" class="form-control" value="0.00001000">',
		'</div><div class="col-md-6">',
		'<label>Manual ROD funding txid</label><input id="otcManualRodTxid" class="form-control" placeholder="optional txid">',
		'<label>Manual LTC funding txid</label><input id="otcManualLtcTxid" class="form-control" placeholder="optional txid">',
		'</div></div>',
		'<div id="otcExecStatus" style="font-size:12px;margin-top:8px"></div>',
		'<div class="btn-toolbar" style="margin-top:10px">',
		'<button class="btn btn-primary btn-sm otcExecBtn" data-action="fund-rod">Alice: broadcast ROD funding</button> ',
		'<button class="btn btn-default btn-sm otcExecBtn" data-action="verify-rod">Bob: verify ROD funding</button> ',
		'<button class="btn btn-primary btn-sm otcExecBtn" data-action="fund-ltc">Bob: broadcast LTC funding</button> ',
		'<button class="btn btn-default btn-sm otcExecBtn" data-action="verify-ltc">Alice: verify LTC funding</button> ',
		'<button class="btn btn-success btn-sm otcExecBtn" data-action="claim-ltc">Alice: claim LTC</button> ',
		'<button class="btn btn-success btn-sm otcExecBtn" data-action="claim-rod">Bob: recover/claim ROD</button> ',
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
	function log(m) { $('#otcLog').prepend('<div>[' + ts() + '] ' + esc(m) + '</div>'); }
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
					npub = NOSTR.identityFromWif(walletId.wif).npub || '';
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
	var allOffers = [];
	function refreshBook() {
		$('#otcBookTime').text('Scanning ROD DB…');
		$('#otcScanReport').html('<span class="text-muted">name_scan regexp <code>^d/otc-swap/</code> …</span>');
		ENGINE.scanOtcOrdersFromDb({ regexp: ENGINE.OTC_NAME_REGEXP || '^d/otc-swap/' }).then(function (result) {
			var offers = (result && result.offers) ? result.offers : [];
			var reports = (result && result.reports) ? result.reports : [];
			allOffers = offers;
			/* Group by price for ask/bid */
			var asks = {}, bids = {};
			offers.forEach(function (o) {
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
			var scanned = (result && result.scanned != null) ? result.scanned : reports.length;
			$('#otcBookTime').text(offers.length + ' offers · ' + scanned + ' names · ' + ts());
			$('#otcBookDetail').hide();
			if (reports.length) {
				$('#otcScanReport').html(
					'<div class="text-muted" style="margin-bottom:4px">regexp <code>^d/otc-swap/</code> · ' + scanned + ' name(s)</div>' +
					reports.map(function (r) {
						var color = r.ok ? '#62e6a6' : '#f0ad4e';
						return '<div style="color:' + color + '"><b>' + esc(r.name) + '</b> — ' + esc(r.detail) + '</div>';
					}).join('')
				);
			} else {
				$('#otcScanReport').html('<span class="text-muted">No names matched <code>^d/otc-swap/</code></span>');
			}
		}, function (err) {
			var msg = (err && err.message) ? err.message : (typeof err === 'string' ? err : 'Scan failed');
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
			return '<tr><td>' + esc(o.seller || o._name || '—') + '</td><td>' + esc(o.give || o.rodAmount) + '</td><td>' + esc(o.want || o.ltcAmount) + '</td>' +
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
		}
		ENGINE.startListening(!!restart);
		ENGINE.onSwapMessage = function (env) {
			log('← ' + env.type + ' ' + short(env.swapId));
			autoProcess(env);
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
			['ROD amount', esc(s.terms.rodAmount)],
			['LTC amount', esc(s.terms.ltcAmount)],
			['Rate', esc(rate(s.terms.rodAmount, s.terms.ltcAmount)) + ' LTC/ROD'],
			['Bilateral ready', s.bilateralReady ? '<span class="label label-success">yes</span>' : '<span class="label label-default">no</span>'],
			['Local readiness', readinessSummary(readiness.local)],
			['Remote readiness', readinessSummary(readiness.remote)],
			['Release height', esc(s.terms.releaseRodHeight)],
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

	function executionStatusHtml(session) {
		var e = session.execution || {};
		return [
			'<div><b>ROD funding:</b> ' + txSummary(e.rodFunding) + '</div>',
			'<div><b>LTC funding:</b> ' + txSummary(e.ltcFunding) + '</div>',
			'<div><b>LTC claim:</b> ' + txSummary(e.ltcClaim) + '</div>',
			'<div><b>ROD claim:</b> ' + txSummary(e.rodClaim) + '</div>'
		].join('');
	}

	/* ============ NEW SWAP ============ */
	function clearCounterpartyFields() {
		$('#nsPeer').val('');
		$('#nsPeerXpub').val('');
		nsPrefillFromOrder = false;
		updateNsModeHint();
	}

	function updateNsModeHint() {
		var peer = $.trim($('#nsPeer').val());
		var xpub = $.trim($('#nsPeerXpub').val());
		if (peer && xpub) {
			$('#nsModeHint').html(nsPrefillFromOrder
				? 'Mode: <b>start swap</b> (counterparty loaded from Dashboard order).'
				: 'Mode: <b>start swap</b> (counterparty entered manually).');
		} else {
			$('#nsModeHint').html('Mode: <b>create order</b> — counterparty left empty. Use <b>Create order</b>, or Take an order on the Dashboard to fill counterparty.');
		}
	}
	$('#nsPeer, #nsPeerXpub').on('input change', updateNsModeHint);

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
			coinjs.addressBalance(address, function (response) {
				coinjs.setNetwork(previousNetworkCode || 'ROD');
				var balance = balanceResponseAmount(response);
				if (!response || !response.success || balance == null) {
					d.reject((response && response.error) || (chainCode + ' balance lookup failed'));
					return;
				}
				d.resolve({ chainCode: chainCode, address: address, balance: balance });
			});
		} catch (error) {
			coinjs.setNetwork(previousNetworkCode || 'ROD');
			d.reject((error && error.message) ? error.message : String(error));
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

	function readinessRoleChain(role) {
		return role === 'alice' ? 'ROD' : 'LTC';
	}

	function readinessRequiredAmount(session, role) {
		return role === 'alice' ? session.terms.rodAmount : session.terms.ltcAmount;
	}

	function readinessSummary(readiness) {
		if (!readiness) return '<span class="text-muted">not received</span>';
		return '<code>' + esc(readiness.role || '—') + '</code> · ' + esc(readiness.chain || '—') +
			' · need ' + esc(readiness.requiredAmount) + ' · balance ' + esc(readiness.observedBalance) +
			' · <code style="font-size:10px">' + esc(short(readiness.address)) + '</code> · ' + esc(readiness.verifiedAt || '—');
	}

	function readinessMatches(session, readiness, expectedRole) {
		return !!(readiness && readiness.role === expectedRole && readiness.chain === readinessRoleChain(expectedRole) && readiness.requiredAmount === readinessRequiredAmount(session, expectedRole));
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

	function saveExecution(session, key, evidence) {
		session.execution = session.execution || {};
		session.execution[key] = $.extend({}, session.execution[key] || {}, evidence || {});
		ENGINE.saveLive(session);
		showActiveSwap(session.swapId);
		refreshSwaps();
	}

	function fundingTarget(session, chainCode) {
		return chainCode === 'ROD' ? session.terms.rodFunding : session.terms.ltcFunding;
	}

	function claimDestination(session, chainCode) {
		var pubkey = chainCode === 'LTC' ? session.terms.aliceChildPubKey : session.terms.bobChildPubKey;
		return CHAINS.publicKeyToAddress(chainCode, pubkey, 'legacy');
	}

	function requireWalletWif() {
		if (!checkWallet() || !walletId || !walletId.wif) throw new Error('Open your wallet first');
		return walletId.wif;
	}

	function verifyFunding(session, chainCode, manualTxid) {
		var target = fundingTarget(session, chainCode);
		var txid = $.trim(manualTxid || (session.execution && session.execution[chainCode === 'ROD' ? 'rodFunding' : 'ltcFunding'] && session.execution[chainCode === 'ROD' ? 'rodFunding' : 'ltcFunding'].txid) || '');
		if (!txid) throw new Error('Enter or receive ' + chainCode + ' funding txid first');
		return ENGINE.findFundingOutput(chainCode, txid, target.multisigAddress, target.amount).then(function (evidence) {
			saveExecution(session, chainCode === 'ROD' ? 'rodFunding' : 'ltcFunding', evidence);
			return evidence;
		});
	}

	function buildRemoteSignature(session, chainCode, claimTx) {
		var remote = chainCode === 'LTC' ? session.remoteLtcClaimSignature : session.remoteRodClaimSignature;
		if (remote) return remote;
		if (session.role === 'alice' && chainCode === 'LTC') return session.remoteNormalSignature || '';
		if (session.role === 'bob' && chainCode === 'ROD') return session.remoteNormalSignature || '';
		return '';
	}

	function getLocalChildWif(session, chainCode) {
		if (!session.localChildPrivateKey) throw new Error('Local swap child private key is unavailable; reopen the wallet that created this session');
		return CHAINS.withChain(chainCode, function () {
			return coinjs.privkey2wif(session.localChildPrivateKey);
		});
	}

	function orderedMultisigSignatures(session, localSig, remoteSig) {
		return session.role === 'alice' ? [localSig, remoteSig] : [remoteSig, localSig];
	}

	function buildClaim(session, chainCode, fundingKey, claimKey, messageType) {
		var funding = session.execution && session.execution[fundingKey];
		if (!funding || funding.vout == null) throw new Error(chainCode + ' funding evidence is missing');
		var redeemScript = fundingTarget(session, chainCode).redeemScript;
		var tx = ENGINE.buildClaimTxFromFunding(chainCode, funding, redeemScript, claimDestination(session, chainCode), $('#otcExecClaimFee').val());
		var localSig = ENGINE.signClaimTx(chainCode, tx, getLocalChildWif(session, chainCode));
		var remoteSig = buildRemoteSignature(session, chainCode, tx);
		if (!remoteSig) {
			var payload = { chainCode: chainCode, signature: localSig, txid: funding.txid, vout: funding.vout };
			if (chainCode === 'LTC') session.localLtcClaimSignature = localSig; else session.localRodClaimSignature = localSig;
			ENGINE.saveLive(session);
			publish(session, chainCode === 'LTC' ? 'swap_ltc_normal_signature' : 'swap_rod_normal_signature', payload);
			throw new Error('Local claim signature sent. Wait for counterparty signature before broadcast.');
		}
		ENGINE.applyMultisigSignatures(chainCode, tx, redeemScript, orderedMultisigSignatures(session, localSig, remoteSig));
		return ENGINE.broadcastTx(chainCode, tx.serialize()).then(function (response) {
			var evidence = { chainCode: chainCode, txid: response.txid, txhex: tx.serialize(), localSignature: localSig, remoteSignature: remoteSig, completedSigHex: localSig, broadcastAt: new Date().toISOString() };
			saveExecution(session, claimKey, evidence);
			publish(session, messageType, evidence);
			return evidence;
		});
	}

	$(document).on('click', '.otcExecBtn', function () {
		var action = $(this).data('action'), session = selectedSwap(), $button = $(this);
		if (!session) { flash('warning', 'Select an active swap first'); return; }
		$button.prop('disabled', true);
		try {
			if (action === 'fund-rod') {
				if (session.role !== 'alice') throw new Error('Only Alice/Seller broadcasts ROD funding');
				if (!confirm('Broadcast ROD funding to 2-of-2 multisig? Funds can be stuck without counterparty cooperation.')) throw new Error('Funding cancelled');
				ENGINE.buildFundingTx('ROD', requireWalletWif(), session.terms.rodFunding.multisigAddress, session.terms.rodAmount, $('#otcExecFundingFee').val()).then(function (built) { return ENGINE.broadcastTx('ROD', built.txhex).then(function (response) { built.txid = response.txid || built.txid; built.broadcastAt = new Date().toISOString(); saveExecution(session, 'rodFunding', built); SWAP.safeAdvance(session, 'ALICE_ROD_FUNDED', 'ROD funding broadcast'); publish(session, 'swap_rod_funded', { funding: built }); slog(session.swapId, '→ ROD funding broadcast ' + built.txid); }); }).fail(function (error) { flash('danger', error.message || error); }).always(function () { $button.prop('disabled', false); });
				return;
			}
			if (action === 'verify-rod') {
				verifyFunding(session, 'ROD', $('#otcManualRodTxid').val()).then(function (evidence) { SWAP.safeAdvance(session, 'ALICE_ROD_FUNDED', 'ROD funding verified'); publish(session, 'swap_rod_funded', { funding: evidence }); slog(session.swapId, '✓ ROD funding verified'); }).fail(function (error) { flash('danger', error.message || error); }).always(function () { $button.prop('disabled', false); });
				return;
			}
			if (action === 'fund-ltc') {
				if (session.role !== 'bob') throw new Error('Only Bob/Buyer broadcasts LTC funding');
				if (!confirm('Broadcast LTC funding to 2-of-2 multisig? Funds can be stuck without counterparty cooperation.')) throw new Error('Funding cancelled');
				ENGINE.buildFundingTx('LTC', requireWalletWif(), session.terms.ltcFunding.multisigAddress, session.terms.ltcAmount, $('#otcExecFundingFee').val()).then(function (built) { return ENGINE.broadcastTx('LTC', built.txhex).then(function (response) { built.txid = response.txid || built.txid; built.broadcastAt = new Date().toISOString(); saveExecution(session, 'ltcFunding', built); SWAP.safeAdvance(session, 'BOB_LTC_FUNDED', 'LTC funding broadcast'); publish(session, 'swap_ltc_funded', { funding: built }); slog(session.swapId, '→ LTC funding broadcast ' + built.txid); }); }).fail(function (error) { flash('danger', error.message || error); }).always(function () { $button.prop('disabled', false); });
				return;
			}
			if (action === 'verify-ltc') {
				verifyFunding(session, 'LTC', $('#otcManualLtcTxid').val()).then(function (evidence) { SWAP.safeAdvance(session, 'READY', 'LTC funding verified'); publish(session, 'swap_ltc_funded', { funding: evidence }); slog(session.swapId, '✓ LTC funding verified'); }).fail(function (error) { flash('danger', error.message || error); }).always(function () { $button.prop('disabled', false); });
				return;
			}
			if (action === 'claim-ltc') {
				if (session.role !== 'alice') throw new Error('Only Alice claims LTC first');
				buildClaim(session, 'LTC', 'ltcFunding', 'ltcClaim', 'swap_ltc_claimed').then(function (evidence) { SWAP.safeAdvance(session, 'LTC_CLAIMED', 'LTC claimed'); slog(session.swapId, '→ LTC claimed ' + evidence.txid); }).fail(function (error) { flash('warning', error.message || error); }).always(function () { $button.prop('disabled', false); });
				return;
			}
			if (action === 'claim-rod') {
				if (session.role !== 'bob') throw new Error('Only Bob claims ROD after recovering secret/signature');
				buildClaim(session, 'ROD', 'rodFunding', 'rodClaim', 'swap_rod_claimed').then(function (evidence) { SWAP.safeAdvance(session, 'ROD_CLAIMED', 'ROD claimed'); SWAP.safeAdvance(session, 'COMPLETE', 'Swap complete'); ENGINE.recordTrade(session); publish(session, 'swap_complete', { rodClaim: evidence }); slog(session.swapId, '✓ COMPLETE ' + evidence.txid); refreshHistory(); }).fail(function (error) { flash('warning', error.message || error); }).always(function () { $button.prop('disabled', false); });
				return;
			}
			if (action === 'refresh') {
				var tasks = [];
				if (session.execution && session.execution.rodFunding && session.execution.rodFunding.txid) tasks.push(verifyFunding(session, 'ROD'));
				if (session.execution && session.execution.ltcFunding && session.execution.ltcFunding.txid) tasks.push(verifyFunding(session, 'LTC'));
				$.when.apply($, tasks).always(function () { slog(session.swapId, '↻ Refreshed funding confirmations'); $button.prop('disabled', false); });
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
			var role = $('#nsRole').val(), peer = $.trim($('#nsPeer').val()), peerXpub = $.trim($('#nsPeerXpub').val());
			if (!peer) throw new Error('Enter counterparty identity, or Take an order on the Dashboard first');
			if (!peerXpub) throw new Error('Enter counterparty swap xpub, or Take an order on the Dashboard first');
			if (peerXpub === swapAcct.xpub) throw new Error('Counterparty xpub must differ from your swap xpub');
			$btn.prop('disabled', true);
			flash('info', 'Checking wallet balance…');

			ensureWalletFundsForRole(role, $('#nsRod').val(), $('#nsLtc').val()).then(function (balanceProof) {
				var myAddr = walletId.address;
				var orderId = (role === 'alice' ? myAddr : peer) + '/otc-' + Date.now();
				var swapId = SWAP.swapIdFromOrder(orderId, '1', role === 'alice' ? peer : myAddr);

				var session = SWAP.createOfferSession({
					role: role, swapId: swapId, orderId: orderId,
					rodAmount: $('#nsRod').val(), ltcAmount: $('#nsLtc').val(),
					releaseRodHeight: $('#nsRelease').val(),
					sellerSwapAccountKey: role === 'alice' ? swapAcct.xprv : peerXpub,
					buyerSwapAccountKey: role === 'alice' ? peerXpub : swapAcct.xprv
				});

				session.readiness = session.readiness || {};
				session.readiness.local = buildReadinessEvidence(balanceProof);

				if (role === 'alice') {
					var y = coinjs.adaptor.generateSecret();
					session.adaptorSecret = y;
					session.adaptorPoint = coinjs.adaptor.publicKey(y);
				}

				ENGINE.saveLive(session);

				/* Auto-negotiate */
				SWAP.advanceState(session, 'NEGOTIATING', 'Terms sent');
				if (ENGINE.pool) {
					ENGINE.publishSwapMessage(session, 'swap_terms', { terms: session.terms });
					if (session.adaptorPoint) ENGINE.publishSwapMessage(session, 'swap_adaptor_point', { adaptorPoint: session.adaptorPoint });
					ENGINE.publishSwapMessage(session, 'swap_ready', { readiness: session.readiness.local });
					slog(session.swapId, '→ Sent terms + readiness via Nostr');
				}
				SWAP.advanceState(session, 'TERMS_ACCEPTED', 'Auto-accepted');
				markBilateralReady(session);
				ENGINE.saveLive(session);

				$('#nsSwapId').val(session.swapId);
				$('#nsOffer').val(JSON.stringify({
					version: 1, type: 'otc-order', seller: role === 'alice' ? myAddr : peer,
					buyer: role === 'bob' ? myAddr : peer,
					pair: 'ROD/LTC', give: session.terms.rodAmount, want: session.terms.ltcAmount,
					sellerSwapXpub: session.sellerSwapXpub, buyerSwapXpub: session.buyerSwapXpub,
					releaseRodHeight: session.terms.releaseRodHeight,
					termsHash: session.terms.termsHash
				}, null, 2));

				/* Clear counterparty after successful start so next visit is a clean order form */
				clearCounterpartyFields();
				refreshSwaps();
				flash('success', 'Swap created: ' + short(swapId));
			}, function (error) {
				flash('danger', error);
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

	function autoProcess(env) {
		var all = ENGINE.loadLive(), sess = all[env.swapId]; if (!sess) return;
		/* Decrypt keys */
		var pw = ENGINE.walletPassword();
		if (sess._ep && pw) { try { sess.localChildPrivateKey = CryptoJS.AES.decrypt(sess._ep, pw).toString(CryptoJS.enc.Utf8); } catch (e) {} }
		if (sess._ea && pw) { try { sess.adaptorSecret = CryptoJS.AES.decrypt(sess._ea, pw).toString(CryptoJS.enc.Utf8); } catch (e) {} }
		var p = env.payload || {};

		if (env.type === 'swap_adaptor_point' && p.adaptorPoint) {
			sess.adaptorPoint = p.adaptorPoint;
			slog(env.swapId, '← Adaptor point received');
			ENGINE.saveLive(sess);
		}
		if (env.type === 'swap_ready' && p.readiness) {
			sess.readiness = sess.readiness || {};
			sess.readiness.remote = p.readiness;
			slog(env.swapId, '← Remote readiness proof received');
			markBilateralReady(sess);
			ENGINE.saveLive(sess);
			refreshSwaps();
		}
		if ((env.type.indexOf('adaptor_signature') > -1) && p.hex) {
			sess.remoteAdaptorSignature = p.hex;
			slog(env.swapId, '← Remote adaptor sig');
			ENGINE.saveLive(sess);
		}
		if ((env.type.indexOf('normal_signature') > -1) && (p.hex || p.signature)) {
			var sig = p.hex || p.signature;
			sess.remoteNormalSignature = sig;
			if (env.type === 'swap_ltc_normal_signature') sess.remoteLtcClaimSignature = sig;
			if (env.type === 'swap_rod_normal_signature') sess.remoteRodClaimSignature = sig;
			slog(env.swapId, '← Remote normal sig');
			ENGINE.saveLive(sess);
		}
		if (env.type === 'swap_rod_funded' && p.funding) {
			sess.execution = sess.execution || {}; sess.execution.rodFunding = p.funding;
			try { SWAP.safeAdvance(sess, 'ALICE_ROD_FUNDED', 'Remote ROD funding evidence'); } catch (e1) {}
			slog(env.swapId, '← ROD funding evidence'); ENGINE.saveLive(sess);
		}
		if (env.type === 'swap_ltc_funded' && p.funding) {
			sess.execution = sess.execution || {}; sess.execution.ltcFunding = p.funding;
			try { SWAP.safeAdvance(sess, 'BOB_LTC_FUNDED', 'Remote LTC funding evidence'); } catch (e2) {}
			slog(env.swapId, '← LTC funding evidence'); ENGINE.saveLive(sess);
		}
		if (env.type === 'swap_ltc_claimed') {
			sess.execution = sess.execution || {}; sess.execution.ltcClaim = p;
			try { SWAP.safeAdvance(sess, 'LTC_CLAIMED', 'Remote LTC claim evidence'); } catch (e3) {}
			slog(env.swapId, '← LTC claimed evidence'); ENGINE.saveLive(sess);
			if (sess.role === 'bob' && p.completedSigHex) tryRecover(sess, p.completedSigHex);
		}
		if (env.type === 'swap_secret_recovered') {
			try { SWAP.safeAdvance(sess, 'SECRET_RECOVERED', 'Remote secret recovery evidence'); } catch (e4) {}
			slog(env.swapId, '← Secret recovery evidence'); ENGINE.saveLive(sess);
		}
		if (env.type === 'swap_rod_claimed') {
			sess.execution = sess.execution || {}; sess.execution.rodClaim = p;
			try { SWAP.safeAdvance(sess, 'ROD_CLAIMED', 'Remote ROD claim evidence'); } catch (e5) {}
			slog(env.swapId, '← ROD claimed evidence'); ENGINE.saveLive(sess);
		}
		if (env.type === 'swap_complete') {
			sess.state = 'COMPLETE'; ENGINE.saveLive(sess);
			ENGINE.recordTrade(sess);
			slog(env.swapId, '✓ COMPLETE');
			refreshHistory();
		}
	}

	function trySign(sess) {
		/* Legacy demo-only placeholder signer intentionally disabled for real swap execution. */
		return;
		if (!sess.adaptorPoint || !sess.localChildPrivateKey || sess._signed) return;
		try {
			var rodClaim = ENGINE.buildClaimTx('ROD', 'pending_rod', 0, sess.terms.rodFunding.redeemScript, sess.terms.rodAmount, CHAINS.publicKeyToAddress('ROD', sess.terms.bobChildPubKey), '0.00001000');
			var ltcClaim = ENGINE.buildClaimTx('LTC', 'pending_ltc', 0, sess.terms.ltcFunding.redeemScript, sess.terms.ltcAmount, CHAINS.publicKeyToAddress('LTC', sess.terms.aliceChildPubKey), '0.00001000');
			var wif = coinjs.privkey2wif(sess.localChildPrivateKey);
			if (sess.role === 'alice') {
				var ra = ENGINE.makeAdaptorSig(sess, rodClaim), ln = ENGINE.signOrd(ltcClaim, wif);
				sess.localAdaptorSignature = ra.hex; sess.localNormalSignature = ln;
				if (ENGINE.pool) { ENGINE.publishSwapMessage(sess, 'swap_rod_adaptor_signature', { hex: ra.hex }); ENGINE.publishSwapMessage(sess, 'swap_ltc_normal_signature', { hex: ln }); }
				slog(sess.swapId, '→ Auto: ROD adaptor + LTC normal');
			} else {
				var la = ENGINE.makeAdaptorSig(sess, ltcClaim), rn = ENGINE.signOrd(rodClaim, wif);
				sess.localAdaptorSignature = la.hex; sess.localNormalSignature = rn;
				if (ENGINE.pool) { ENGINE.publishSwapMessage(sess, 'swap_ltc_adaptor_signature', { hex: la.hex }); ENGINE.publishSwapMessage(sess, 'swap_rod_normal_signature', { hex: rn }); }
				slog(sess.swapId, '→ Auto: LTC adaptor + ROD normal');
			}
			sess._signed = true;
			try { SWAP.advanceState(sess, 'SIGNATURES_EXCHANGED', 'Auto-signed'); } catch (e) {}
			ENGINE.saveLive(sess);
			refreshSwaps();
		} catch (e) { slog(sess.swapId, 'Sign error: ' + e.message); }
	}

	function tryRecover(sess, csig) {
		if (sess.role !== 'bob' || !sess.localAdaptorSignature) return;
		try {
			var y = ENGINE.recoverSecret(Crypto.util.hexToBytes(sess.localAdaptorSignature), csig, sess.adaptorPoint);
			slog(sess.swapId, '✓ Secret recovered');
			if (sess.remoteAdaptorSignature) {
				var comp = ENGINE.completeSig(Crypto.util.hexToBytes(sess.remoteAdaptorSignature), y);
				slog(sess.swapId, '→ ROD claim sig completed');
				if (ENGINE.pool) ENGINE.publishSwapMessage(sess, 'swap_rod_claimed', { completedSigHex: comp });
			}
			sess.state = 'COMPLETE'; ENGINE.saveLive(sess);
			ENGINE.recordTrade(sess);
			slog(sess.swapId, '✓ COMPLETE');
			if (ENGINE.pool) ENGINE.publishSwapMessage(sess, 'swap_complete', {});
			refreshSwaps(); refreshHistory();
		} catch (e) { slog(sess.swapId, 'Recover error: ' + e.message); }
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
	startNostr();
	refreshConnStatus();
	setInterval(function () {
		if ($('#otc').is(':visible')) refreshRelayStatus();
	}, 5000);
	setInterval(function () {
		if ($('#otc').is(':visible')) refreshRpcStatus();
	}, 30000);
	refreshSwaps();
	log('OTC swap app ready — Nostr connecting automatically');
});
