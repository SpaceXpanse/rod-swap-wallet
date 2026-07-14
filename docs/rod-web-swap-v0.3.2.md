Browser OTC Swap Client — Straight Implementation Plan

1. Fixed architecture

The OTC swap client runs entirely inside "SpaceXpanse/rod-web-wallet".

ROD name-value DB
    Order publication and authoritative swap state

Nostr
    Direct negotiation and signature exchange

rod-web-wallet
    Key derivation, transaction construction and signing

ROD blockchain
    Order authority, release height and ROD settlement

External UTXO chain
    Counter-asset settlement

OpenSpeX
    Observation and verification only

There are no:

- HTLCs;
- refund transactions;
- recovery signers;
- validator keys;
- fallback spending paths;
- native-chain timeout branches;
- escrow services;
- private-key transmission.

Each funded output is a plain swap-specific 2-of-2 multisig.

---

2. Files to add

js/ecdsa-adaptor.js
js/otc-swap.js
js/otc-nostr.js
js/otc-chains.js
js/otc-storage.js

Responsibilities:

ecdsa-adaptor.js
    ECDSA adaptor-signature mathematics

otc-swap.js
    Swap construction, state transitions and settlement

otc-nostr.js
    Peer-to-peer swap messages

otc-chains.js
    Address and transaction parameters for ROD, LTC and later chains

otc-storage.js
    Local swap-session persistence

Existing files remain responsible for:

js/coin.js
    BIP32, secp256k1, scripts and transaction construction

js/ellipticcurve.js
    Point and scalar arithmetic

---

3. Extract reusable ECDSA helpers

Refactor the existing transaction signer so ordinary ECDSA and adaptor ECDSA use the same underlying functions.

Add:

coinjs.ecdsa = {
    getCurve: function () {},
    getOrder: function () {},

    scalarFromHex: function (hex) {},
    scalarToHex: function (scalar) {},

    pointFromHex: function (hex) {},
    pointToHex: function (point) {},

    publicKeyFromPrivate: function (privateKey) {},

    serializeDER: function (r, s) {},
    parseDER: function (signature) {},

    normalizeLowS: function (s) {},

    verifyRaw: function (
        messageHash,
        publicKey,
        r,
        s
    ) {}
};

The existing "transactionSig()" function must continue producing ordinary signatures through these helpers.

---

4. Implement tagged hashing

Add:

coinjs.taggedHash = function (tag, bytes) {};

Use:

ECDSAadaptor/non
ECDSAadaptor/aux
DLEQ

The implementation is:

tagHash = SHA256(tag)

SHA256(
    tagHash ||
    tagHash ||
    input
)

---

5. Implement adaptor nonce generation

Add:

coinjs.adaptorNonce = function ({
    signingPrivateKey,
    adaptorPublicKey,
    messageHash,
    auxiliaryRandomness
}) {};

Inputs:

x = signer private scalar
Y = adaptor public point
m = exact transaction signature hash
aux = 32 random bytes

Output:

k in [1, n - 1]

Derivation:

maskedKey =
    x XOR taggedHash(
        "ECDSAadaptor/aux",
        aux
    )

k =
    taggedHash(
        "ECDSAadaptor/non",
        maskedKey ||
        Y ||
        m
    ) mod n

---

6. Implement the 162-byte adaptor signature

Use this exact binary format:

Offset    Length    Field

0         33        R
33        33        RPrime
66        32        sPrime
98        32        DLEQ challenge
130       32        DLEQ response

Add:

coinjs.adaptor.serialize = function (signature) {};

coinjs.adaptor.deserialize = function (bytes) {};

All scalars are fixed-width 32-byte big-endian values.

All points are compressed 33-byte secp256k1 points.

---

7. Implement DLEQ proof generation

The proof establishes that the same nonce "k" was used in:

RPrime = kG
R      = kY

Add:

coinjs.dleq.prove = function ({
    nonce,
    noncePoint,
    adaptorPoint,
    encryptedNoncePoint,
    auxiliaryRandomness
}) {};

Process:

a = deterministic proof nonce

A1 = aG
A2 = aY

e = taggedHash(
    "DLEQ",
    G ||
    Y ||
    RPrime ||
    R ||
    A1 ||
    A2
) mod n

z = a + e·k mod n

Return:

e
z

---

8. Implement DLEQ verification

Add:

coinjs.dleq.verify = function ({
    noncePoint,
    adaptorPoint,
    encryptedNoncePoint,
    challenge,
    response
}) {};

Reconstruct:

A1 = zG - eRPrime
A2 = zY - eR

Then recompute:

eCheck = taggedHash(
    "DLEQ",
    G ||
    Y ||
    RPrime ||
    R ||
    A1 ||
    A2
) mod n

Accept when:

eCheck = e

---

9. Implement adaptor-signature creation

Public function:

coinjs.adaptor.encrypt = function ({
    messageHash,
    signingPrivateKey,
    adaptorPublicKey,
    auxiliaryRandomness
}) {};

Variables:

x = signing private key
X = xG

y = adaptor secret
Y = yG

k = adaptor signing nonce

Calculate:

R      = kY
RPrime = kG

r = x-coordinate(R) mod n

sPrime =
    k^-1 ·
    (m + r·x)
    mod n

Generate the DLEQ proof that:

log_G(RPrime) = log_Y(R)

Return the 162-byte adaptor signature.

---

10. Implement adaptor-signature verification

Public function:

coinjs.adaptor.verify = function ({
    messageHash,
    signingPublicKey,
    adaptorPublicKey,
    adaptorSignature
}) {};

First verify the DLEQ proof.

Then compute:

r = x-coordinate(R) mod n

w = sPrime^-1 mod n

u1 = m·w mod n
u2 = r·w mod n

P = u1G + u2X

Accept only when:

P = RPrime

---

11. Implement adaptor-signature completion

Public function:

coinjs.adaptor.complete = function ({
    adaptorSignature,
    adaptorSecret
}) {};

Calculate:

s =
    sPrime · y^-1
    mod n

Normalize to low-S:

if s > n/2:
    s = n - s

Return an ordinary DER-encoded ECDSA signature using:

r = x-coordinate(R) mod n

The result is inserted into an ordinary multisig transaction.

---

12. Implement adaptor-secret recovery

Public function:

coinjs.adaptor.recover = function ({
    adaptorSignature,
    completedSignature,
    adaptorPublicKey
}) {};

Parse the completed signature:

(r, s)

Calculate:

y1 =
    sPrime · s^-1
    mod n

y2 =
    -y1
    mod n

Select the value satisfying:

yG = Y

Return "y".

---

13. Final adaptor API

coinjs.adaptor = {
    generateSecret: function () {},

    publicKey: function (
        secret
    ) {},

    encrypt: function (
        messageHash,
        signingPrivateKey,
        adaptorPublicKey,
        auxiliaryRandomness
    ) {},

    verify: function (
        messageHash,
        signingPublicKey,
        adaptorPublicKey,
        adaptorSignature
    ) {},

    complete: function (
        adaptorSignature,
        adaptorSecret
    ) {},

    recover: function (
        adaptorSignature,
        completedSignature,
        adaptorPublicKey
    ) {}
};

---

14. Create one dedicated swap HD account

The wallet generates:

swap xprv
swap xpub

The public swap xpub is published with the seller’s OTC offers.

The main wallet xpub is not used by the OTC client.

Example offer:

{
  "version": 1,
  "type": "otc-order",
  "seller": "alice.rod",
  "pair": "ROD/LTC",
  "give": "1000.00000000",
  "want": "5.00000000",
  "sellerSwapXpub": "xpub..."
}

---

15. Derive one child public key per swap

The swap identifier determines the child derivation index.

Example:

swapId = hash(order name + order revision + buyer identity)

Convert it to a non-hardened BIP32 child index:

index =
    first 31 bits of SHA256(swapId)

Both parties derive:

sellerSwapXpub / index
buyerSwapXpub / index

This produces:

Alice child public key
Bob child public key

The same secp256k1 public key is used on both ROD and LTC.

Only the address encoding and chain parameters differ.

---

16. Derive both chain addresses from the same public key

For Alice’s child public key:

Alice ROD address
Alice LTC address

For Bob’s child public key:

Bob ROD address
Bob LTC address

The underlying public keys remain identical.

ROD and LTC only apply different:

address prefixes
Bech32 HRPs
script-address prefixes
transaction parameters

No LTC public key is published or exchanged separately.

---

17. Buyer acceptance

Bob accepts Alice’s order and sends:

{
  "type": "swap_accept",
  "orderId": "...",
  "buyerSwapXpub": "xpub...",
  "proposedReleaseHeight": 1500000
}

Alice and Bob derive each other’s child public keys using the same "swapId".

---

18. Agree the swap terms

The canonical terms contain:

{
  "swapId": "...",
  "orderId": "...",
  "pair": "ROD/LTC",

  "rodAmount": "1000.00000000",
  "ltcAmount": "5.00000000",

  "sellerSwapXpub": "xpub...",
  "buyerSwapXpub": "xpub...",

  "childIndex": 381,
  "releaseRodHeight": 1500000,

  "aliceChildPubKey": "...",
  "bobChildPubKey": "..."
}

Both wallets calculate the same terms hash.

---

19. Alice creates the adaptor secret

Alice generates:

y

Then calculates:

Y = yG

Alice sends only "Y" to Bob.

{
  "type": "swap_adaptor_point",
  "swapId": "...",
  "adaptorPoint": "02..."
}

---

20. Build the ROD funding output

Alice and Bob independently construct:

2
<Alice child pubkey>
<Bob child pubkey>
2
CHECKMULTISIG

Alice’s funding transaction places:

1000 ROD

into that 2-of-2 output.

---

21. Build the LTC funding output

The identical two public keys are used:

2
<Alice child pubkey>
<Bob child pubkey>
2
CHECKMULTISIG

Bob’s funding transaction places:

5 LTC

into that 2-of-2 output.

Only the chain-specific transaction and address encoding differ.

---

22. Build the claim transactions

Before funding, construct:

ROD claim

Alice’s ROD 2-of-2 output
    →
Bob’s ROD address

LTC claim

Bob’s LTC 2-of-2 output
    →
Alice’s LTC address

The transaction outputs, amounts and fees are fixed before signature exchange.

---

23. Exchange the LTC signatures

Bob creates an adaptor signature for the exact LTC claim transaction:

message:
    LTC claim transaction hash

signing key:
    Bob child private key

adaptor point:
    Y

Bob sends:

Bob encrypted LTC signature

Alice verifies it.

Alice creates and sends her ordinary LTC signature for the same claim transaction.

Alice now has:

Alice ordinary LTC signature
Bob encrypted LTC signature
y

---

24. Exchange the ROD signatures

Alice creates an adaptor signature for the exact ROD claim transaction:

message:
    ROD claim transaction hash

signing key:
    Alice child private key

adaptor point:
    Y

Alice sends:

Alice encrypted ROD signature

Bob verifies it.

Bob creates and sends his ordinary ROD signature.

Bob now has:

Bob ordinary ROD signature
Alice encrypted ROD signature

---

25. Broadcast the funding transactions

Alice broadcasts the ROD funding transaction.

State:

ALICE_ROD_FUNDED

Bob verifies the exact output, amount and redeem script.

Bob broadcasts the LTC funding transaction.

State:

BOB_LTC_FUNDED

Alice verifies the exact output, amount and redeem script.

State:

READY

---

26. Wait for the ROD release height

The swap remains in "READY" until:

current ROD height >= agreed release height

ROD is the only protocol clock.

---

27. Alice claims the LTC

Alice completes Bob’s encrypted LTC signature:

Bob completed LTC signature =
    complete(
        Bob encrypted LTC signature,
        y
    )

She combines:

Alice ordinary LTC signature
Bob completed LTC signature

and broadcasts the LTC claim transaction.

State:

LTC_CLAIMED

Alice receives the LTC.

---

28. Bob recovers the adaptor secret

Bob reads his completed signature from the LTC transaction.

He calculates:

y =
    recover(
        Bob encrypted LTC signature,
        Bob completed LTC signature,
        Y
    )

State:

SECRET_RECOVERED

Alice does not send "y".

---

29. Bob claims the ROD

Bob completes Alice’s encrypted ROD signature:

Alice completed ROD signature =
    complete(
        Alice encrypted ROD signature,
        y
    )

He combines:

Bob ordinary ROD signature
Alice completed ROD signature

and broadcasts the ROD claim transaction.

State:

ROD_CLAIMED

Bob receives the ROD.

---

30. Complete the swap

Once both claim transactions are observed:

state = COMPLETE

The ROD order record is updated or removed.

The final record contains:

{
  "swapId": "...",
  "state": "complete",
  "rodFundingTxid": "...",
  "ltcFundingTxid": "...",
  "rodClaimTxid": "...",
  "ltcClaimTxid": "..."
}

---

31. Minimal state machine

OPEN
NEGOTIATING
TERMS_ACCEPTED
SIGNATURES_EXCHANGED
ALICE_ROD_FUNDED
BOB_LTC_FUNDED
READY
LTC_CLAIMED
SECRET_RECOVERED
ROD_CLAIMED
COMPLETE

There are no alternative settlement states.

---

32. Minimal Nostr message types

swap_accept
swap_terms
swap_adaptor_point

swap_ltc_adaptor_signature
swap_ltc_normal_signature

swap_rod_adaptor_signature
swap_rod_normal_signature

swap_rod_funded
swap_ltc_funded
swap_ready

swap_ltc_claimed
swap_secret_recovered
swap_rod_claimed
swap_complete

Each message includes:

{
  "version": 1,
  "swapId": "...",
  "type": "...",
  "sequence": 1,
  "previousEventId": "...",
  "payload": {}
}

---

33. Local persistence

Store each active swap locally:

{
    swapId,
    role,
    terms,
    childIndex,

    sellerSwapXpub,
    buyerSwapXpub,

    localChildPrivateKey,
    localChildPublicKey,
    remoteChildPublicKey,

    adaptorSecret,
    adaptorPoint,

    localNormalSignature,
    localAdaptorSignature,
    remoteNormalSignature,
    remoteAdaptorSignature,

    rodFundingTx,
    ltcFundingTx,
    rodClaimTx,
    ltcClaimTx,

    state
}

Alice stores the adaptor secret.

Bob stores only the adaptor point until recovering the secret from the LTC claim.

---

34. Implementation sequence

Commit 1

Extract reusable ECDSA and secp256k1 helpers.

Commit 2

Implement tagged hashing and adaptor nonce generation.

Commit 3

Implement DLEQ proof creation and verification.

Commit 4

Implement adaptor signature serialization.

Commit 5

Implement adaptor "encrypt()" and "verify()".

Commit 6

Implement adaptor "complete()" and "recover()".

Commit 7

Add deterministic and randomized adaptor-signature tests.

Commit 8

Add dedicated swap xpub creation and child derivation.

Commit 9

Add chain-independent child-public-key address conversion.

Commit 10

Add ROD and LTC 2-of-2 funding and claim transaction builders.

Commit 11

Add Nostr negotiation and signature exchange.

Commit 12

Add ROD order publication and acceptance.

Commit 13

Add the OTC user interface.

Commit 14

Add full browser-driven end-to-end swap testing.

---

35. Final user flow

Alice publishes offer with swap xpub
↓
Bob accepts with his swap xpub
↓
Both derive the same child public keys
↓
Both derive ROD and LTC addresses
↓
Alice publishes adaptor point
↓
Both construct funding and claim transactions
↓
They exchange adaptor and ordinary signatures
↓
Alice funds ROD
↓
Bob funds LTC
↓
ROD release height arrives
↓
Alice claims LTC
↓
Bob extracts adaptor secret
↓
Bob claims ROD
↓
Swap completes

The finished OTC client uses one published swap xpub per participant, one derived secp256k1 child key per swap, one adaptor secret, two ordinary 2-of-2 outputs, and ROD block height as the sole settlement trigger.