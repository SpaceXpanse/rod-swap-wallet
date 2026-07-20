/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright (c) SpaceXpanse contributors */

(function(){
	var root = window.rodOtc = window.rodOtc || {};
	var chainsModule = root.chains = root.chains || {};

	chainsModule.definitions = {
		ROD: {
			code: 'ROD',
			pub: 0x3c,
			priv: 0x4e,
			multisig: 0x4b,
			bech32Hrp: 'rod',
			decimals: 8
		},
		LTC: {
			code: 'LTC',
			pub: 0x30,
			priv: 0xb0,
			multisig: 0x32,
			bech32Hrp: 'ltc',
			decimals: 8
		}
	};

	function getDefinition(chainCode){
		var definition = chainsModule.definitions[chainCode];
		if(!definition){
			throw new Error('Unsupported OTC chain: ' + chainCode);
		}
		return definition;
	}

	chainsModule.withChain = function(chainCode, callback){
		var previousNetworkCode = coinjs.activeNetwork || 'ROD';
		try {
			coinjs.setNetwork(chainCode);
			return callback(getDefinition(chainCode));
		} finally {
			coinjs.setNetwork(previousNetworkCode);
		}
	};

	chainsModule.decimalToSats = function(amount){
		var text = String(amount == null ? '0' : amount).replace(/^\s+|\s+$/g, '');
		if(!/^\d+(\.\d{0,8})?$/.test(text)){
			throw new Error('Invalid decimal amount: ' + text);
		}
		var parts = text.split('.');
		var whole = parts[0].replace(/^0+(?=\d)/, '') || '0';
		var fraction = (parts[1] || '').slice(0, 8);
		while(fraction.length < 8){
			fraction += '0';
		}
		var sats = parseInt(whole, 10) * 100000000 + parseInt(fraction || '0', 10);
		if(!isFinite(sats) || sats < 0 || Math.floor(sats) !== sats || sats > 9007199254740991){
			throw new Error('Amount is outside safe integer range: ' + text);
		}
		return sats;
	};

	chainsModule.satsToDecimal = function(sats){
		var value = parseInt(sats, 10);
		if(!isFinite(value) || value < 0){
			throw new Error('Invalid satoshi amount: ' + sats);
		}
		var whole = Math.floor(value / 100000000);
		var fraction = String(value % 100000000);
		while(fraction.length < 8){
			fraction = '0' + fraction;
		}
		return whole + '.' + fraction;
	};

	chainsModule.getWalletMaterialForChain = function(wif, chainCode){
		return chainsModule.withChain(chainCode, function(){
			var privateKey = coinjs.wif2privkey(wif);
			var publicKey = coinjs.wif2pubkey(wif);
			var address = coinjs.wif2address(wif);
			return {
				chainCode: chainCode,
				wif: wif,
				privkey: privateKey.privkey,
				pubkey: publicKey.pubkey,
				address: address.address
			};
		});
	};

	function hash160(hexValue){
		return ripemd160(Crypto.SHA256(Crypto.util.hexToBytes(hexValue), {asBytes: true}), {asBytes: true});
	}

	function base58WithVersion(versionByte, payloadBytes){
		var addressBytes = [versionByte].concat(payloadBytes);
		var checksum = Crypto.SHA256(Crypto.SHA256(addressBytes, {asBytes: true}), {asBytes: true}).slice(0, 4);
		return coinjs.base58encode(addressBytes.concat(checksum));
	}

	function bech32Address(chainDefinition, publicKeyHex){
		var witnessProgram = hash160(publicKeyHex);
		return coinjs.bech32_encode(chainDefinition.bech32Hrp, [coinjs.bech32.version].concat(coinjs.bech32_convert(witnessProgram, 8, 5, true)));
	}

	chainsModule.publicKeyToAddress = function(chainCode, publicKeyHex, addressType){
		var chainDefinition = getDefinition(chainCode);
		var normalizedType = addressType || 'legacy';
		if(normalizedType === 'bech32'){
			return bech32Address(chainDefinition, publicKeyHex);
		}
		return base58WithVersion(chainDefinition.pub, hash160(publicKeyHex));
	};

	chainsModule.publicKeysToMultisig = function(chainCode, publicKeys, requiredSignatures){
		var chainDefinition = getDefinition(chainCode);
		var script = coinjs.script();
		script.writeOp(81 + (requiredSignatures * 1) - 1);
		for(var index = 0; index < publicKeys.length; index++){
			script.writeBytes(Crypto.util.hexToBytes(publicKeys[index]));
		}
		script.writeOp(81 + publicKeys.length - 1);
		script.writeOp(174);
		var scriptHash = ripemd160(Crypto.SHA256(script.buffer, {asBytes: true}), {asBytes: true});
		return {
			address: base58WithVersion(chainDefinition.multisig, scriptHash),
			redeemScript: Crypto.util.bytesToHex(script.buffer),
			scriptHashHex: Crypto.util.bytesToHex(scriptHash),
			required: requiredSignatures,
			pubkeys: publicKeys.slice(0)
		};
	};

	chainsModule.amountToBaseUnits = function(amountString){
		return String(chainsModule.decimalToSats(amountString));
	};

	chainsModule.planFunding = function(chainCode, publicKeys, requiredSignatures, amountString){
		var multisig = chainsModule.publicKeysToMultisig(chainCode, publicKeys, requiredSignatures);
		return {
			chainCode: chainCode,
			amount: amountString,
			amountBaseUnits: chainsModule.amountToBaseUnits(amountString),
			multisigAddress: multisig.address,
			redeemScript: multisig.redeemScript,
			scriptHashHex: multisig.scriptHashHex,
			proofId: Crypto.util.bytesToHex(Crypto.SHA256(Crypto.util.hexToBytes(multisig.redeemScript + Crypto.util.bytesToHex(Crypto.charenc.UTF8.stringToBytes(amountString))), {asBytes: true}))
		};
	};

	chainsModule.planClaim = function(chainCode, sourceMultisig, destinationAddress, amountString, feeString){
		var summary = [chainCode, sourceMultisig.redeemScript, destinationAddress, amountString, feeString || '0'].join('|');
		return {
			chainCode: chainCode,
			sourceAddress: sourceMultisig.multisigAddress,
			sourceRedeemScript: sourceMultisig.redeemScript,
			destinationAddress: destinationAddress,
			amount: amountString,
			fee: feeString || '0',
			planningHash: Crypto.util.bytesToHex(Crypto.SHA256(Crypto.charenc.UTF8.stringToBytes(summary), {asBytes: true}))
		};
	};

	chainsModule.testAgainstRodGlobals = function(){
		var fixturePublicKey = '02cc2d342f2e3e6d013e19f9e5c1637e7e64d07d8a0caa13a4509198e882afb1f3';
		var rodAddress = chainsModule.publicKeyToAddress('ROD', fixturePublicKey, 'legacy');
		var expectedRodAddress = coinjs.pubkey2address(fixturePublicKey);
		var beforeGlobals = JSON.stringify({pub: coinjs.pub, priv: coinjs.priv, multisig: coinjs.multisig, hrp: coinjs.bech32.hrp});
		var ltcAddress = chainsModule.publicKeyToAddress('LTC', fixturePublicKey, 'legacy');
		var afterGlobals = JSON.stringify({pub: coinjs.pub, priv: coinjs.priv, multisig: coinjs.multisig, hrp: coinjs.bech32.hrp});
		return {
			name: 'Immutable chain helpers',
			passed: rodAddress === expectedRodAddress && beforeGlobals === afterGlobals && ltcAddress !== rodAddress,
			rodAddress: rodAddress,
			expectedRodAddress: expectedRodAddress,
			ltcAddress: ltcAddress,
			globalsStable: beforeGlobals === afterGlobals
		};
	};
})();
