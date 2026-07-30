#!/usr/bin/env node
'use strict';

/*
 * Fast real-browser integration gate.
 *
 * Node-only tests cover pure contracts and mutations. This file proves those
 * modules are actually wired into the unmodified index.html, jQuery runtime,
 * DOM, localStorage, and service-worker shell.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { staticServer } = require('./mock-infra');

const APP_DIR = process.env.APP_DIR || path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.UNIT_PORT || 9400);
const results = [];

function step(name, ok, detail) {
	results.push({ name, ok, detail: detail || '' });
	console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
}

function launchOptions() {
	const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
		process.env.PW_CHROMIUM_EXECUTABLE_PATH;
	let args;
	if (process.env.PLAYWRIGHT_CHROMIUM_ARGS_JSON) {
		args = JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS_JSON);
		if (!Array.isArray(args)) throw new Error('PLAYWRIGHT_CHROMIUM_ARGS_JSON must be a JSON array');
	}
	const unsafe = (args || []).find((arg) => /^--single-process(?:=|$)/.test(String(arg)));
	if (unsafe) {
		throw new Error(
			'Unsafe Chromium argument ' + unsafe + ': --single-process invalidates browser-context isolation'
		);
	}
	if (configured) return { executablePath: configured, args };
	if (fs.existsSync('/opt/pw-browsers/chromium')) {
		return { executablePath: '/opt/pw-browsers/chromium', args };
	}
	return args ? { args } : {};
}

async function loadApp(browser, serviceWorkers) {
	const context = await browser.newContext({ serviceWorkers: serviceWorkers || 'block' });
	const page = await context.newPage();
	const pageErrors = [];
	const consoleErrors = [];
	page.on('pageerror', (error) => pageErrors.push(String(error)));
	page.on('console', (message) => {
		if (message.type() === 'error') consoleErrors.push(message.text());
	});
	await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'load' });
	await page.waitForFunction(
		() => window.coinjs && window.rodOtc && window.rodOtc.engine &&
			window.rodOtc.swap && window.rodOtc.chains && window.rodOtc.validation,
		null,
		{ timeout: 30000 }
	);
	return { context, page, pageErrors, consoleErrors };
}

async function main() {
	const server = await staticServer(APP_DIR, PORT);
	const browser = await chromium.launch(launchOptions());
	try {
		const loaded = await loadApp(browser, 'block');
		const page = loaded.page;

		step('app loads without uncaught JavaScript errors', loaded.pageErrors.length === 0, loaded.pageErrors.join(' | '));

		const validation = await page.evaluate(() => window.rodOtc.validation.runAll());
		step(
			'in-page cryptography, chain, storage, Nostr, and swap fixtures pass',
			validation.passed === true,
			validation.results.map((result) => result.name + ':' + (result.passed ? 'ok' : 'FAIL')).join(', ')
		);

		const scope = await page.evaluate(() => {
			const walletNetworks = Object.keys(window.coinjs.networks).sort();
			const otcChains = Object.keys(window.rodOtc.chains.definitions).sort();
			const feeChains = Object.keys(window.rodOtc.swap.ALT_CHAIN_FEES).sort();
			const explorerSupport = {};
			for (const code of walletNetworks) {
				if (code === 'ROD') continue;
				explorerSupport[code] = window.coinjs.explorer.isSupported(window.coinjs.networks[code]);
			}
			const menuCoins = Array.from(document.querySelectorAll('.walletCoinSelect'))
				.map((node) => node.getAttribute('data-coin')).sort();
			const otcOptions = Array.from(document.querySelectorAll('#nsAltChain option'))
				.map((node) => node.value).filter(Boolean).sort();
			return { walletNetworks, otcChains, feeChains, explorerSupport, menuCoins, otcOptions };
		});
		const expectedWallet = ['BCH', 'BTC', 'DGB', 'DOGE', 'LTC', 'ROD'];
		step(
			'wallet menu and registered wallet networks agree',
			JSON.stringify(scope.walletNetworks) === JSON.stringify(expectedWallet) &&
				JSON.stringify(scope.menuCoins) === JSON.stringify(expectedWallet),
			'networks=' + scope.walletNetworks.join(',') + ' menu=' + scope.menuCoins.join(',')
		);
		step(
			'OTC scope is explicit and excludes wallet-only BTC/BCH/DGB',
			JSON.stringify(scope.otcChains) === JSON.stringify(['DOGE', 'LTC', 'ROD']) &&
				JSON.stringify(scope.feeChains) === JSON.stringify(['DOGE', 'LTC']) &&
				JSON.stringify(scope.otcOptions) === JSON.stringify(['DOGE', 'LTC']),
			'definitions=' + scope.otcChains.join(',') + ' fees=' + scope.feeChains.join(',') +
				' selector=' + scope.otcOptions.join(',')
		);
		step(
			'every wallet-only explorer backend has a registered driver',
			Object.values(scope.explorerSupport).every(Boolean),
			JSON.stringify(scope.explorerSupport)
		);

		const defaults = await page.evaluate(() => {
			const pick = (code) => {
				const network = window.coinjs.networks[code];
				return { apiType: network.apiType, apiBase: network.apiBase, segwit: network.segwit };
			};
			return {
				LTC: pick('LTC'), DOGE: pick('DOGE'), BTC: pick('BTC'),
				BCH: pick('BCH'), DGB: pick('DGB')
			};
		});
		step(
			'default explorer types and endpoints are chain-correct',
			defaults.LTC.apiType === 'esplora' && defaults.LTC.apiBase === 'https://litecoinspace.org/api' &&
				defaults.DOGE.apiType === 'blockcypher' && defaults.DOGE.apiBase === 'https://api.blockcypher.com/v1/doge/main' &&
				defaults.BTC.apiType === 'esplora' && defaults.BTC.apiBase === 'https://mempool.space/api' &&
				defaults.BCH.apiType === 'blockbook' && defaults.BCH.apiBase === 'https://bch1.trezor.io' &&
				defaults.DGB.apiType === 'esplora' && defaults.DGB.apiBase === 'https://digiexplorer.info/api',
			JSON.stringify(defaults)
		);

		const chainChecks = await page.evaluate(() => {
			const C = window.rodOtc.chains;
			const S = window.rodOtc.swap;
			const key1 = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
			const key2 = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
			const dogeMultisig = C.publicKeysToMultisig('DOGE', [key1, key2], 2);
			let dogeBech32Rejected = false;
			let walletOnlyRejected = false;
			try { C.publicKeyToAddress('DOGE', key1, 'bech32'); } catch (error) { dogeBech32Rejected = true; }
			try { C.getPolicy('DGB'); } catch (error) { walletOnlyRejected = true; }
			const ltcSafe = S.assertRefundOrdering({
				altChain: 'LTC', refundRodHeight: 100480, altRefundLockHeight: 200024,
				rodConfirmations: 1, altConfirmations: 1
			}, 100000, 200000);
			const dogeSafe = S.assertRefundOrdering({
				altChain: 'DOGE', refundRodHeight: 100480, altRefundLockHeight: 300060,
				rodConfirmations: 1, altConfirmations: 6
			}, 100000, 300000);
			let unsafeRejected = false;
			try {
				S.assertRefundOrdering({
					altChain: 'DOGE', refundRodHeight: 100480, altRefundLockHeight: 300470,
					rodConfirmations: 1, altConfirmations: 6
				}, 100000, 300000);
			} catch (error) { unsafeRejected = true; }
			return {
				dogeAddress: C.publicKeyToAddress('DOGE', key1, 'legacy'),
				dogeMultisig: dogeMultisig.address,
				dogeBech32Rejected,
				walletOnlyRejected,
				dogePolicy: C.getPolicy('DOGE'),
				ltcSafe,
				dogeSafe,
				unsafeRejected
			};
		});
		step(
			'DOGE address, multisig, SegWit refusal, and relay policy match mainnet',
			chainChecks.dogeAddress === 'DFpN6QqFfUm3gKNaxN6tNcab1FArL9cZLE' &&
				chainChecks.dogeMultisig === '9tAfWptDmGyYyFjKKr5VpApUKzq9hFpBJ1' &&
				chainChecks.dogeBech32Rejected &&
				chainChecks.dogePolicy.feeRatePerByte === 1000 &&
				chainChecks.dogePolicy.hardDustSats === 100000 &&
				chainChecks.dogePolicy.softDustSats === 1000000,
			chainChecks.dogeAddress + ' / ' + chainChecks.dogeMultisig
		);
		step(
			'wallet-only chains fail closed when passed into OTC policy',
			chainChecks.walletOnlyRejected === true
		);
		step(
			'refund wall-clock ordering accepts safe LTC/DOGE and rejects reversal',
			chainChecks.ltcSafe.rodRemainingSeconds > chainChecks.ltcSafe.altRemainingSeconds &&
				chainChecks.dogeSafe.rodRemainingSeconds > chainChecks.dogeSafe.altRemainingSeconds &&
				chainChecks.unsafeRejected === true
		);

		await loaded.context.close();

		const pwa = await loadApp(browser, 'allow');
		const pwaReady = await pwa.page.evaluate(async () => {
			if (!('serviceWorker' in navigator)) return { supported: false };
			const registration = await Promise.race([
				navigator.serviceWorker.ready,
				new Promise((_, reject) => setTimeout(() => reject(new Error('service worker ready timeout')), 15000))
			]);
			return { supported: true, active: !!registration.active };
		});
		step('service worker installs and activates', pwaReady.supported && pwaReady.active, JSON.stringify(pwaReady));

		await pwa.context.setOffline(true);
		await pwa.page.reload({ waitUntil: 'load', timeout: 30000 });
		await pwa.page.waitForFunction(
			() => window.coinjs && window.rodOtc && window.rodOtc.engine,
			null,
			{ timeout: 30000 }
		);
		const offline = await pwa.page.evaluate(() => ({
			title: document.title,
			hasWallet: !!document.getElementById('wallet'),
			hasOtc: !!document.getElementById('otc'),
			styles: Array.from(document.styleSheets).length
		}));
		step(
			'PWA shell reloads offline with wallet, OTC UI, and styles',
			offline.hasWallet && offline.hasOtc && offline.styles >= 3,
			JSON.stringify(offline)
		);
		await pwa.context.setOffline(false);
		await pwa.context.close();
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}

	const failed = results.filter((result) => !result.ok);
	console.log('\n' + (results.length - failed.length) + '/' + results.length + ' browser integration gates passed');
	process.exitCode = failed.length ? 1 : 0;
}

main().catch((error) => {
	console.error('BROWSER HARNESS ERROR: ' + (error.stack || error));
	process.exit(1);
});
