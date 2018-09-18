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

// Make key pair for Chris
const ChrisMaster = hd.generate();
const ChrisKey = ChrisMaster.derivePath('m/44/0/0/0/0');
const ChrisKeyRing = KeyRing.fromPrivate(ChrisKey.privateKey);
const ChrisPubKey = ChrisKeyRing.publicKey;

console.log('Chris pubkey: ', ChrisPubKey);

// redeem script: <Chris pubKey> OP_CHECKSIGVERIFY
const redeem = new Script();
redeem.pushData(ChrisPubKey);
redeem.pushSym('OP_CHECKSIG');
redeem.compile();
// make redeem script into P2SH address
const addr = Address.fromScripthash(redeem.hash160());

// Create a fake coinbase for our funding
// and send 50,000 satoshis to the P2SH address.
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

// Create our spending transaction.
const mtxSimple = new MTX();

// Send 40,000 satoshis to Chris,
// creating a fee of 10,000 satoshis.
mtxSimple.addOutput({
  address: ChrisKeyRing.getAddress(),
  value: 40000
});

// Add output 0 from our coinbase as an input.
const coin = Coin.fromTX(cb, 0, -1);
mtxSimple.addCoin(coin);

// input (sig) script: <Chris signature>
const inputSimple = new Script();
inputSimple.pushInt(0); // <-- signature placeholder!
inputSimple.pushData(redeem.toRaw());
inputSimple.compile();
mtxSimple.inputs[0].script = inputSimple;

// Sign the input with Chris's private key
// params are (input index, redeem script, value, signing key, type, version)
const version = 0 // legacy (not segwit)
const sigSwap = mtxSimple.signature(
    0,
    redeem,
    coin.value,
    ChrisKey.privateKey,
    null,
    version
  );

// add signature to input
inputSimple.setData(0, sigSwap);
inputSimple.compile();

// Check scripts and sigs
console.log('SIMPLE MTX Verify:   ', mtxSimple.verify(flags));