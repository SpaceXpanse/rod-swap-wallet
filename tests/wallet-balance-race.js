#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(process.env.APP_DIR || path.join(__dirname, '..'));
const source = fs.readFileSync(path.join(root, 'js', 'coinbin.js'), 'utf8');

function extractFunction(functionName) {
	const marker = 'function ' + functionName + '(';
	const start = source.indexOf(marker);
	assert(start !== -1, functionName + ' must exist in coinbin.js');
	const bodyStart = source.indexOf('{', start);
	let depth = 0;
	for (let i = bodyStart; i < source.length; i += 1) {
		if (source[i] === '{') depth += 1;
		if (source[i] === '}') {
			depth -= 1;
			if (depth === 0) {
				return source.slice(start, i + 1);
			}
		}
	}
	throw new Error('Unable to extract ' + functionName);
}

const factorySource = extractFunction('createWalletBalanceRequestEpoch');
const createEpoch = vm.runInNewContext('(' + factorySource + ')');

function testDgbToRodRace() {
	const requests = createEpoch();
	const dgb = requests.begin('DGB', 'DGB-address');
	assert(dgb, 'DGB request must start');

	/* A network switch invalidates DGB before the ROD render starts. */
	requests.reset();
	const rod = requests.begin('ROD', 'ROD-address');
	assert(rod, 'ROD request must start immediately after DGB');

	assert.strictEqual(
		requests.finish(dgb, 'ROD', 'ROD-address'),
		false,
		'late DGB callback must not own the ROD balance UI'
	);
	assert.strictEqual(
		requests.finish(rod, 'ROD', 'ROD-address'),
		true,
		'current ROD callback must update and release the balance UI'
	);
}

function testLateRequestCannotHideNewLoader() {
	const requests = createEpoch();
	const dgb = requests.begin('DGB', 'DGB-address');
	requests.reset();
	const ltc = requests.begin('LTC', 'LTC-address');

	assert.strictEqual(requests.finish(dgb, 'LTC', 'LTC-address'), false);
	assert.strictEqual(
		requests.begin('LTC', 'LTC-address'),
		false,
		'a duplicate current lookup remains coalesced after the stale callback'
	);
	assert.strictEqual(requests.finish(ltc, 'LTC', 'LTC-address'), true);
}

function testAddressChangeInvalidatesOldCallback() {
	const requests = createEpoch();
	const legacy = requests.begin('DGB', 'legacy-address');
	const segwit = requests.begin('DGB', 'segwit-address');

	assert(segwit, 'a new address on the same network must start immediately');
	assert.strictEqual(requests.finish(legacy, 'DGB', 'segwit-address'), false);
	assert.strictEqual(requests.finish(segwit, 'DGB', 'segwit-address'), true);
}

function testDgbRoutingAndCsp() {
	const coinSource = fs.readFileSync(path.join(root, 'js', 'coin.js'), 'utf8');
	const coinbinSource = fs.readFileSync(path.join(root, 'js', 'coinbin.js'), 'utf8');
	const engineSource = fs.readFileSync(path.join(root, 'js', 'otc-engine.js'), 'utf8');
	const explorerSource = fs.readFileSync(path.join(root, 'js', 'otc-explorer.js'), 'utf8');
	const headers = fs.readFileSync(path.join(root, '_headers'), 'utf8');
	const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

	assert(/'DGB'\s*:\s*\{[\s\S]*?'apiType'\s*:\s*'esplora'[\s\S]*?'apiBase'\s*:\s*'https:\/\/digiexplorer\.info\/api'/.test(coinSource),
		'DGB must default to Digiexplorer through the Esplora driver');

	const browser = {
		console,
		document: { location: { protocol: 'http:', hostname: 'localhost' } },
		window: null
	};
	browser.window = browser;
	vm.createContext(browser);
	vm.runInContext(coinSource, browser, { filename: 'js/coin.js' });
	vm.runInContext(explorerSource, browser, { filename: 'js/otc-explorer.js' });
	browser.coinjs.setNetwork('DGB');
	assert.strictEqual(browser.coinjs.explorer.isSupported(browser.coinjs.getNetwork()), true,
		'coinjs.explorer.isSupported() must accept DGB');

	let routedToDgbExplorer = false;
	let normalizedBalance = null;
	browser.coinjs.explorer.balance = function(network, address) {
		return {
			then(resolve) {
				routedToDgbExplorer = network.code === 'DGB' && address === 'DGB-test-address';
				resolve(123456789);
			}
		};
	};
	browser.coinjs.addressBalance('DGB-test-address', function(result) {
		normalizedBalance = result;
	});
	assert.strictEqual(routedToDgbExplorer, true,
		'coinjs.addressBalance() must dispatch DGB through the explorer adapter');
	assert.strictEqual(normalizedBalance.data[0].balance, '1.23456789',
		'DGB explorer base units must be normalized for the wallet display');

	assert(/connect-src[^;\n]*https:\/\/digiexplorer\.info/.test(headers),
		'CSP must permit the default DGB backend');
	assert(/'DGB'\s*:\s*\[[^\]]*https:\/\/api\.blockchair\.com\/digibyte/.test(coinbinSource),
		'wallet API settings must migrate the old shipped DGB default');
	assert(/savedDgb\.apiUrl\s*===\s*'https:\/\/api\.blockchair\.com\/digibyte'/.test(engineSource),
		'OTC engine settings must migrate the old shipped DGB default');
	assert(/STATIC_CACHE_VERSION\s*=\s*"[^"]*2\.9\.0-beta\.1/.test(serviceWorker),
		'service-worker cache must carry the current release identity');
}

function runEngineWithSavedConfig(savedConfig) {
	const engineSource = fs.readFileSync(path.join(root, 'js', 'otc-engine.js'), 'utf8');
	const values = { rodOtcEngineConfig: JSON.stringify(savedConfig) };
	const browser = {
		console,
		window: null,
		localStorage: {
			getItem(key) { return values[key] || null; },
			setItem(key, value) { values[key] = value; }
		},
		coinjs: {
			networks: {
				ROD: { apiBase: 'https://api.spacexpanse.org:1234' },
				DGB: { apiBase: 'https://digiexplorer.info/api', apiType: 'esplora' }
			},
			explorer: { drivers: { esplora: {}, blockchair: {} } }
		}
	};
	browser.window = browser;
	browser.$ = browser.jQuery = {
		extend(target) {
			for (let i = 1; i < arguments.length; i++) {
				if (arguments[i]) Object.assign(target, arguments[i]);
			}
			return target;
		},
		isArray: Array.isArray,
		trim(value) { return String(value).trim(); }
	};
	browser.rodOtc = {
		swap: { DEFAULT_ALT_CHAIN: 'LTC' },
		storage: {},
		chains: {},
		nostr: {}
	};
	vm.createContext(browser);
	vm.runInContext(engineSource, browser, { filename: 'js/otc-engine.js' });
	return { browser, saved: JSON.parse(values.rodOtcEngineConfig) };
}

function testDgbDefaultMigration() {
	const oldDefault = runEngineWithSavedConfig({
		altChains: {
			DGB: {
				apiUrl: 'https://api.blockchair.com/digibyte',
				apiType: 'blockchair'
			}
		}
	});
	assert.strictEqual(oldDefault.saved.altChains.DGB, undefined,
		'the old shipped Blockchair default must be removed from persisted engine config');
	assert.strictEqual(oldDefault.browser.coinjs.networks.DGB.apiType, 'esplora');
	assert.strictEqual(oldDefault.browser.coinjs.networks.DGB.apiBase, 'https://digiexplorer.info/api');

	const custom = runEngineWithSavedConfig({
		altChains: {
			DGB: {
				apiUrl: 'https://dgb.example.invalid/api',
				apiType: 'esplora'
			}
		}
	});
	assert.strictEqual(custom.saved.altChains.DGB.apiUrl, 'https://dgb.example.invalid/api',
		'a custom DGB endpoint must not be migrated');
	assert.strictEqual(custom.browser.coinjs.networks.DGB.apiBase, 'https://dgb.example.invalid/api');
}

testDgbToRodRace();
testLateRequestCannotHideNewLoader();
testAddressChangeInvalidatesOldCallback();
testDgbRoutingAndCsp();
testDgbDefaultMigration();

console.log('wallet balance and DGB default regressions: 5/5 passed');
