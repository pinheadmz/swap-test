// requirements
const {
  Outpoint,
  Coin,
  MTX,
  TX,
  Address,
  ScriptNum,
  hd,
  KeyRing,
  Script,
  Stack
} = require('bcoin');
const bcrypto = require('bcrypto');
const assert = require('assert');

// set params for this example
const NETWORK = 'main';
const flags = Script.flags.STANDARD_VERIFY_FLAGS;
const CLTV_LOCKTIME = 10; // can't spend redeem until this height
const TX_nLOCKTIME = 15;  // minimum height the spending tx can be mined 

// generate preimage and hash for hash-lock
const secret = bcrypto.randomBytes(32);
const hash = bcrypto.sha256.digest(secret);
console.log('secret: ', secret.toString('hex'));
console.log('hash:   ', hash.toString('hex'));

// generate keys for Timmy and Chris
// Timmy has BTC and wants BCH, initiates proposal
// Chris has BCH and wants BTC, accepts proposal
const TimmyMaster = hd.generate();
const TimmyKey = TimmyMaster.derivePath('m/44/0/0/0/0');
const TimmyKeyRing = KeyRing.fromPrivate(TimmyKey.privateKey);
const TimmyPubKey = TimmyKeyRing.publicKey;

const ChrisMaster = hd.generate();
const ChrisKey = ChrisMaster.derivePath('m/44/0/0/0/0');
const ChrisKeyRing = KeyRing.fromPrivate(ChrisKey.privateKey);
const ChrisPubKey = ChrisKeyRing.publicKey;

console.log('Timmy pub: ', TimmyPubKey);
console.log('Chris pub: ', ChrisPubKey);

// Create BTC swap redeem script:
// OP_IF
//   OP_SHA256 <H> OP_EQUALVERIFY <Chris public key> OP_CHECKSIG
// OP_ELSE
//   <locktime> OP_CHECKLOCKTIMEVERIFY <Timmy public key> OP_CHECKSIG
const redeem = new Script();
redeem.pushSym('OP_IF');
redeem.pushSym('OP_SHA256');
redeem.pushData(hash);
redeem.pushSym('OP_EQUALVERIFY');
redeem.pushData(ChrisPubKey);
redeem.pushSym('OP_CHECKSIG');
redeem.pushSym('OP_ELSE');
redeem.pushInt(CLTV_LOCKTIME);
redeem.pushSym('OP_CHECKLOCKTIMEVERIFY');
redeem.pushSym('OP_DROP');
redeem.pushData(TimmyPubKey);
redeem.pushSym('OP_CHECKSIG');
redeem.pushSym('OP_ENDIF');
redeem.compile();
// console.log('Output script:\n  ', redeem.toString());
const addr = Address.fromScripthash(redeem.hash160());
// console.log('BTC Address: ', addr.toString(NETWORK));

// Create a fake coinbase for our funding
// and send 50,000 satoshis to the swap address.
const cb = new MTX();
cb.addInput({
  prevout: new Outpoint(),
  script: new Script(),
  sequence: 0xffffffff
});
cb.addOutput({
  address: addr,
  value: 50000
});
// console.log('Swap funding TX:\n', cb);


//  ---------------- REFUND TEST ----------------
// Create our redeeming transaction.
const mtxRefund = new MTX();

// Send 40,000 satoshis to Timmy,
// creating a fee of 10,000 satoshis.
mtxRefund.addOutput({
  address: TimmyKeyRing.getAddress(),
  value: 40000
});

// Add output 0 from our coinbase tx as an input.
const coin = Coin.fromTX(cb, 0, -1);
mtxRefund.addCoin(coin);

// Build sig script to spend from redeem script:
// <Timmy signature> <0>
const inputRefund = new Script();
inputRefund.pushInt(0); // <-- signature placeholder!
inputRefund.pushInt(0);
inputRefund.pushData(redeem.toRaw());
inputRefund.compile();
// console.log('Refund input script: ', inputRefund.toString());
mtxRefund.inputs[0].script = inputRefund;

// set nLocktime for spending tx (after swap period expires)
mtxRefund.setLocktime(parseInt(TX_nLOCKTIME));

// Sign the input with Timmy's private key
// params are: (input index, prevout script, value, key, type, version)
const version = 0  // legacy (not segwit)
const sigRefund = mtxRefund.signature(
    0,
    redeem,
    coin.value,
    TimmyKey.privateKey,
    null,
    version
  );

// add signature to input script
inputRefund.setData(0, sigRefund);
inputRefund.compile();
// console.log('Signed refund input script: ', inputRefund.toString());

// Check scripts and sigs
// console.log('Completed signed REFUND TX:\n', mtxRefund);
console.log('REFUND MTX Verify: ', mtxRefund.verify(flags));

// Make tx immutable
//const txRefund = mtxRefund.toTX();

// it should still verify (need mtx's coin view to verify tx)
//// console.log('REFUND TX Verify:  ', txRefund.verify(mtxRefund.view));



//  ---------------- SWAP TEST ----------------
// Create our redeeming transaction.
const mtxSwap = new MTX();

// Send 40,000 satoshis to Chris,
// creating a fee of 10,000 satoshis.
mtxSwap.addOutput({
  address: ChrisKeyRing.getAddress(),
  value: 40000
});

// Add redeem 0 from our coinbase as an input.
mtxSwap.addCoin(coin);

// Build sig script to spend from redeem script:
// <Chris signature> <S> <1>
const inputSwap = new Script();
inputSwap.pushInt(0); // <-- signature placeholder!
inputSwap.pushData(secret);
inputSwap.pushInt(1);
inputSwap.pushData(redeem.toRaw());
inputSwap.compile();
// console.log("Swap input script:   ", inputSwap.toString());
mtxSwap.inputs[0].script = inputSwap;

// Sign the input with Chris's private key
// params are (this input index, prevout script, value, key, type, version)
const sigSwap = mtxSwap.signature(
    0,
    redeem,
    coin.value,
    ChrisKey.privateKey,
    null,
    version
  );

// add signature to input
inputSwap.setData(0, sigSwap);
inputSwap.compile();
// console.log('Signed swap input script: ', inputSwap.toString());

// Check scripts and sigs
// console.log('Completed signed SWAP TX:\n', mtxSwap);
console.log('SWAP MTX Verify:   ', mtxSwap.verify(flags));

// Make tx immutable
//const txSwap = mtxSwap.toTX();

// it should still verify (need mtx's coin view to verify tx)
// console.log('REFUND TX Verify:  ', txSwap.verify(mtxSwap.view));

