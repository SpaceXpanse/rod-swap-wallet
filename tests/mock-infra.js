/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright (c) SpaceXpanse contributors */

/*
 * Mock infrastructure for the ROD↔LTC OTC swap end-to-end proof.
 *  - MockChain: in-memory UTXO chain with FULL independent tx validation
 *    (bitcoinjs-lib legacy sighash + @noble/curves secp256k1 signature checks)
 *  - rodApiServer: mimics api.spacexpanse.org:1234 (sats for /unspent,
 *    Core-style coin floats for /transaction vout values)
 *  - esploraServer: mimics litecoinspace.org/api (sats everywhere)
 *  - nostrRelay: minimal NIP-01 relay over ws://
 */
'use strict';
const http = require('http');
const crypto = require('crypto');
const { Transaction, script: bscript, crypto: bcrypto } = require('bitcoinjs-lib');
const { secp256k1 } = require('@noble/curves/secp256k1');
const bs58check = require('bs58check');
const { WebSocketServer } = require('ws');

function sha256d(buf) {
  const a = crypto.createHash('sha256').update(buf).digest();
  return crypto.createHash('sha256').update(a).digest();
}
function hash160(buf) {
  return bcrypto.hash160(buf);
}
function p2pkhScript(pubkeyHash) {
  return Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), pubkeyHash, Buffer.from([0x88, 0xac])]);
}
function p2shScript(scriptHash) {
  return Buffer.concat([Buffer.from([0xa9, 0x14]), scriptHash, Buffer.from([0x87])]);
}
function addressToScript(address) {
  const payload = Buffer.from(bs58check.decode(address));
  const version = payload[0];
  const hash = payload.subarray(1);
  // P2SH versions used by this app: ROD 0x4b, LTC 0x32. P2PKH: ROD 0x3c, LTC 0x30.
  if (version === 0x4b || version === 0x32) return p2shScript(hash);
  return p2pkhScript(hash);
}
function scriptToAddress(scriptBuf, chain) {
  const pubVer = chain === 'LTC' ? 0x30 : 0x3c;
  const p2shVer = chain === 'LTC' ? 0x32 : 0x4b;
  if (scriptBuf.length === 25 && scriptBuf[0] === 0x76) {
    return bs58check.encode(Buffer.concat([Buffer.from([pubVer]), scriptBuf.subarray(3, 23)]));
  }
  if (scriptBuf.length === 23 && scriptBuf[0] === 0xa9) {
    return bs58check.encode(Buffer.concat([Buffer.from([p2shVer]), scriptBuf.subarray(2, 22)]));
  }
  return '';
}
function verifyDerSig(sigWithHashType, msgHash, pubkey) {
  try {
    const der = sigWithHashType.subarray(0, sigWithHashType.length - 1);
    const sig = secp256k1.Signature.fromDER(der);
    return secp256k1.verify(sig, msgHash, pubkey, { lowS: false });
  } catch (e) {
    return false;
  }
}

class MockChain {
  constructor(name) {
    this.name = name;              // 'ROD' | 'LTC'
    this.utxos = new Map();        // 'txid:vout' -> {txid, vout, value, script(Buffer), address}
    this.txs = new Map();          // txid -> {hex, tx, vouts:[{value, script, address, spent}]}
    this.broadcasts = [];          // audit log: {txid, hex, valid, details}
    this.height = 500000;
  }
  credit(address, valueSats) {
    const fakeTxid = crypto.randomBytes(32).toString('hex');
    const script = addressToScript(address);
    this.utxos.set(fakeTxid + ':0', { txid: fakeTxid, vout: 0, value: valueSats, script, address });
    this.txs.set(fakeTxid, {
      hex: '',
      tx: null,
      coinbase: true,
      vouts: [{ value: valueSats, script, address, spent: false }]
    });
    return fakeTxid;
  }
  utxosForAddress(address) {
    return [...this.utxos.values()].filter((u) => u.address === address);
  }
  balance(address) {
    return this.utxosForAddress(address).reduce((s, u) => s + u.value, 0);
  }
  /* Full validation: structure, input existence, value balance, and script/sig
     verification for P2PKH and P2SH 2-of-2 CHECKMULTISIG inputs. */
  validateAndAccept(hex) {
    const details = [];
    let tx;
    try {
      tx = Transaction.fromHex(hex);
    } catch (e) {
      return { ok: false, error: 'unparseable transaction: ' + e.message, details };
    }
    const txid = Buffer.from(sha256d(Buffer.from(hex, 'hex'))).reverse().toString('hex');
    if (this.txs.has(txid)) return { ok: false, error: 'txn-already-known', details };

    let inputSum = 0;
    const spentKeys = [];
    for (let i = 0; i < tx.ins.length; i++) {
      const prevTxid = Buffer.from(tx.ins[i].hash).reverse().toString('hex');
      const key = prevTxid + ':' + tx.ins[i].index;
      const utxo = this.utxos.get(key);
      if (!utxo) return { ok: false, error: 'missing-or-spent input ' + key, details };
      inputSum += utxo.value;
      spentKeys.push(key);

      // ---- script verification ----
      const chunks = bscript.decompile(tx.ins[i].script);
      if (utxo.script[0] === 0x76) {
        // P2PKH: <sig> <pubkey>
        if (!chunks || chunks.length !== 2) return { ok: false, error: `input ${i}: bad P2PKH scriptSig`, details };
        const [sig, pubkey] = chunks;
        if (!Buffer.isBuffer(sig) || !Buffer.isBuffer(pubkey)) return { ok: false, error: `input ${i}: bad P2PKH pushes`, details };
        if (!hash160(pubkey).equals(utxo.script.subarray(3, 23))) {
          return { ok: false, error: `input ${i}: pubkey hash mismatch`, details };
        }
        const hashType = sig[sig.length - 1];
        if (hashType !== 0x01) return { ok: false, error: `input ${i}: unexpected hashtype ${hashType}`, details };
        const sighash = tx.hashForSignature(i, utxo.script, hashType);
        if (!verifyDerSig(sig, sighash, pubkey)) {
          return { ok: false, error: `input ${i}: P2PKH signature INVALID`, details };
        }
        details.push(`input ${i}: P2PKH signature valid (pubkey ${pubkey.toString('hex').slice(0, 16)}…)`);
      } else if (utxo.script[0] === 0xa9) {
        // P2SH: OP_0 <sig...> <redeemScript>
        if (!chunks || chunks.length < 3 || chunks[0] !== 0) {
          return { ok: false, error: `input ${i}: bad P2SH multisig scriptSig`, details };
        }
        const redeem = chunks[chunks.length - 1];
        if (!Buffer.isBuffer(redeem)) return { ok: false, error: `input ${i}: missing redeemScript`, details };
        if (!hash160(redeem).equals(utxo.script.subarray(2, 22))) {
          return { ok: false, error: `input ${i}: redeemScript hash mismatch`, details };
        }
        const redeemChunks = bscript.decompile(redeem);
        const m = redeemChunks[0] - 0x50; // OP_M
        const n = redeemChunks[redeemChunks.length - 2] - 0x50; // OP_N
        if (redeemChunks[redeemChunks.length - 1] !== 0xae) {
          return { ok: false, error: `input ${i}: redeemScript is not CHECKMULTISIG`, details };
        }
        const pubkeys = redeemChunks.slice(1, 1 + n);
        const sigs = chunks.slice(1, chunks.length - 1).filter((c) => Buffer.isBuffer(c) && c.length > 0);
        if (sigs.length < m) return { ok: false, error: `input ${i}: need ${m} sigs, got ${sigs.length}`, details };
        // CHECKMULTISIG order semantics: each sig must match pubkeys in order
        let pkIdx = 0;
        for (let s = 0; s < sigs.length; s++) {
          const hashType = sigs[s][sigs[s].length - 1];
          if (hashType !== 0x01) return { ok: false, error: `input ${i}: sig ${s} unexpected hashtype`, details };
          const sighash = tx.hashForSignature(i, redeem, hashType);
          let matched = false;
          while (pkIdx < pubkeys.length && !matched) {
            if (verifyDerSig(sigs[s], sighash, pubkeys[pkIdx])) matched = true;
            pkIdx++;
          }
          if (!matched) return { ok: false, error: `input ${i}: multisig sig ${s} INVALID or out of order`, details };
        }
        details.push(`input ${i}: P2SH ${m}-of-${n} CHECKMULTISIG valid (${sigs.length} sigs verified in order)`);
      } else {
        return { ok: false, error: `input ${i}: unsupported prevout script`, details };
      }
    }

    let outputSum = 0;
    tx.outs.forEach((o) => { outputSum += Number(o.value); });
    if (outputSum > inputSum) return { ok: false, error: `bad-txns-in-belowout (${inputSum} < ${outputSum})`, details };
    const fee = inputSum - outputSum;
    const bytes = hex.length / 2;
    if (this.name === 'LTC' && fee < Math.ceil(bytes * 1)) {
      // Litecoin Core min relay: 0.00001 LTC/kB = 1 lit per byte (rounded up)
      return { ok: false, error: `min relay fee not met: ${fee} sats for ${bytes} bytes`, details };
    }
    for (const o of tx.outs) {
      if (Number(o.value) > 0 && Number(o.value) < 546) return { ok: false, error: `dust output ${o.value}`, details };
    }

    // accept: spend inputs, add outputs
    spentKeys.forEach((k) => this.utxos.delete(k));
    const vouts = tx.outs.map((o, idx) => {
      const script = Buffer.from(o.script);
      const address = scriptToAddress(script, this.name);
      const rec = { value: Number(o.value), script, address, spent: false };
      this.utxos.set(txid + ':' + idx, { txid, vout: idx, value: rec.value, script, address });
      return rec;
    });
    this.txs.set(txid, { hex, tx, vouts, coinbase: false });
    details.push(`fee ${fee} sats over ${hex.length / 2} bytes (${(fee / (hex.length / 2)).toFixed(2)} sat/B)`);
    this.broadcasts.push({ txid, hex, valid: true, details: details.slice() });
    return { ok: true, txid, fee, details };
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b));
  });
}
function sendJson(res, obj, code) {
  res.writeHead(code || 200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(JSON.stringify(obj));
}
function sendText(res, text, code) {
  res.writeHead(code || 200, {
    'Content-Type': 'text/plain',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(text);
}

/* ROD API mock: sats in /unspent + /balance, Core-style coin floats in /transaction */
function rodApiServer(chain, port) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return sendText(res, '');
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'info') return sendJson(res, { result: { blocks: chain.height } });
    if (parts[0] === 'balance') {
      return sendJson(res, { result: { balance: chain.balance(decodeURIComponent(parts[1])) } });
    }
    if (parts[0] === 'unspent') {
      const utxos = chain.utxosForAddress(decodeURIComponent(parts[1])).map((u) => ({
        txid: u.txid,
        index: u.vout,
        value: u.value, // sats
        scriptPubKey: u.script.toString('hex')
      }));
      return sendJson(res, { result: utxos });
    }
    if (parts[0] === 'transaction') {
      const rec = chain.txs.get(decodeURIComponent(parts[1]));
      if (!rec) return sendJson(res, { error: { message: 'transaction not found' } });
      return sendJson(res, {
        result: {
          txid: parts[1],
          confirmations: 1,
          vout: rec.vouts.map((v, n) => ({
            n,
            value: v.value / 1e8, // Core-style coin float
            scriptPubKey: { hex: v.script.toString('hex'), addresses: [v.address] }
          }))
        }
      });
    }
    if (parts[0] === 'broadcast' && req.method === 'POST') {
      const body = await readBody(req);
      const m = /(?:^|&)raw=([^&]+)/.exec(body);
      const hex = m ? decodeURIComponent(m[1]) : body.trim();
      const r = chain.validateAndAccept(hex);
      if (!r.ok) {
        chain.broadcasts.push({ txid: '', hex, valid: false, details: [r.error] });
        return sendJson(res, { error: { message: r.error } });
      }
      return sendJson(res, { result: r.txid });
    }
    sendJson(res, { error: { message: 'not found' } }, 404);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

/* esplora/mempool mock (litecoinspace.org/api shape): sats everywhere */
function esploraServer(chain, port) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return sendText(res, '');
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
    if (parts[0] !== 'api') return sendText(res, 'not found', 404);
    if (parts[1] === 'address' && parts.length === 3) {
      const addr = decodeURIComponent(parts[2]);
      const funded = chain.balance(addr);
      return sendJson(res, {
        address: addr,
        chain_stats: { funded_txo_sum: funded, spent_txo_sum: 0, tx_count: 1 },
        mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 }
      });
    }
    if (parts[1] === 'address' && parts[3] === 'utxo') {
      const addr = decodeURIComponent(parts[2]);
      // real esplora /utxo has NO scriptpubkey field — keep it that way to
      // exercise the app's fallback-script path
      return sendJson(res, chain.utxosForAddress(addr).map((u) => ({
        txid: u.txid,
        vout: u.vout,
        status: { confirmed: true, block_height: chain.height },
        value: u.value // sats
      })));
    }
    if (parts[1] === 'tx' && req.method === 'GET' && parts.length === 3) {
      const rec = chain.txs.get(decodeURIComponent(parts[2]));
      if (!rec) return sendText(res, 'Transaction not found', 404);
      return sendJson(res, {
        txid: parts[2],
        status: { confirmed: true, block_height: chain.height },
        vout: rec.vouts.map((v) => ({
          scriptpubkey: v.script.toString('hex'),
          scriptpubkey_address: v.address,
          value: v.value // sats
        }))
      });
    }
    if (parts[1] === 'tx' && req.method === 'POST') {
      const hex = (await readBody(req)).trim();
      const r = chain.validateAndAccept(hex);
      if (!r.ok) {
        chain.broadcasts.push({ txid: '', hex, valid: false, details: [r.error] });
        return sendText(res, 'sendrawtransaction RPC error: ' + r.error, 400);
      }
      return sendText(res, r.txid);
    }
    sendText(res, 'not found', 404);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

/* Minimal NIP-01 relay */
function nostrRelay(port) {
  const events = [];
  const wss = new WebSocketServer({ host: '127.0.0.1', port });
  const log = [];
  function matches(ev, filter) {
    if (filter.kinds && !filter.kinds.includes(ev.kind)) return false;
    for (const key of Object.keys(filter)) {
      if (key.startsWith('#')) {
        const tagName = key.slice(1);
        const wanted = filter[key];
        const has = (ev.tags || []).some((t) => t[0] === tagName && wanted.includes(t[1]));
        if (!has) return false;
      }
    }
    return true;
  }
  wss.on('connection', (ws) => {
    const subs = new Map();
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch (e) { return; }
      if (msg[0] === 'EVENT') {
        const ev = msg[1];
        if (!events.find((e) => e.id === ev.id)) events.push(ev);
        log.push({ dir: 'in', kind: ev.kind, id: ev.id });
        ws.send(JSON.stringify(['OK', ev.id, true, '']));
        // fan out to every sub on every client
        for (const client of wss.clients) {
          if (client.readyState !== 1) continue;
          const clientSubs = client._subs || new Map();
          for (const [sid, filter] of clientSubs) {
            if (matches(ev, filter)) client.send(JSON.stringify(['EVENT', sid, ev]));
          }
        }
      } else if (msg[0] === 'REQ') {
        const sid = msg[1];
        const filter = msg[2] || {};
        subs.set(sid, filter);
        ws._subs = subs;
        for (const ev of events) {
          if (matches(ev, filter)) ws.send(JSON.stringify(['EVENT', sid, ev]));
        }
        ws.send(JSON.stringify(['EOSE', sid]));
      } else if (msg[0] === 'CLOSE') {
        subs.delete(msg[1]);
      }
    });
    ws._subs = subs;
  });
  return { wss, events, log };
}

/* Static file server for the wallet app */
function staticServer(rootDir, port) {
  const fs = require('fs');
  const path = require('path');
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject' };
  const server = http.createServer((req, res) => {
    let p = new URL(req.url, 'http://x').pathname;
    if (p === '/') p = '/index.html';
    const file = path.join(rootDir, p);
    if (!file.startsWith(rootDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('nope');
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

module.exports = { MockChain, rodApiServer, esploraServer, nostrRelay, staticServer, addressToScript };
