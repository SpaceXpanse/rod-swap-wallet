coinbin
=======

A Open Source Browser Based SpaceXpanse ROD Wallet. Version 2.1.0-beta by OutCast3k

Live version available at http://rod-web-wallet/ or coinbin3ravkwb24f7rmxx6w3snkjw45jhs5lxbh3yfeg3vpt6janwqd.onion

Github URL: https://github.com/SpaceXpanse RODio/coinbin/

rod-web-wallet supports a number of key features such as: 

- Offline Compressed & uncompressed Address creation.
- Offline Multisignature Address creation.
- "In browser" Key (re)generation. 
- Send and receive payments.
- Ability to decode transactions, redeem scripts and more offline.
- Build custom transactions offline.
- Sign transactions offline.
- Signatures are deterministic as per RFC 6979 (https://tools.ietf.org/html/rfc6979#section-3.2)
- Broadcast transactions.
- nLockTime support.
- Add custom data to transactions with the use of OP_RETURN.
- Support current Dark Wallet Stealth Address structure (as of version Alpha 7) for outputs.
- Brain wallet support.
- Compatible with bitcoin-qt
- An offical .onion address for tor users.
- Offline qrcode creator and scanning tool.
- HD (bip32) support.
- Supports altcoins such as litecoin.
- Replace by fee (RBF) Support.
- Segwit Support.
- Bech32 address support.
- Fee calculator - https://rod-web-wallet/#fees
  - Uses deterministic local fee guidance for ROD (no Coinb.in fee endpoint dependency).
- Transaction rebuild support for RBF and double spending.
- Broadcast flow is JSON-normalized against the ROD API POST /broadcast response format (`{result,error,id}`).

Donation is disabled by default (`0`) in this ROD build to avoid accidental sends to non-ROD addresses.
ROD API endpoint defaults to `https://api.spacexpanse.org:1234`.

