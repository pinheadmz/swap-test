const bcrypto = require('bcrypto');
const {ScriptNum, hd, KeyRing, Script, Stack} = require('bcoin');
const assert = require('assert');

const secret = bcrypto.randomBytes(32);
const hash = bcrypto.sha256.digest(secret);

console.log("secret: ", secret.toString('hex'));
console.log("hash:   ", hash.toString('hex'));

const TimmyMaster = hd.generate();
const TimmyKey = TimmyMaster.derivePath('m/44/0/0/0/0');
const TimmyKeyRing = KeyRing.fromPrivate(TimmyKey.privateKey);
const TimmyPubKey = TimmyKeyRing.publicKey;

const ChrisMaster = hd.generate();
const ChrisKey = ChrisMaster.derivePath('m/44/0/0/0/0');
const ChrisKeyRing = KeyRing.fromPrivate(ChrisKey.privateKey);
const ChrisPubKey = ChrisKeyRing.publicKey;

console.log("Timmy pub: ", TimmyPubKey);
console.log("Chris pub: ", ChrisPubKey);


// `OP_IF OP_SHA256 <H> OP_EQUALVERIFY <Chris public key> OP_CHECKSIGVERIFY OP_ELSE <locktime> OP_CHECKLOCKTIMEVERIFY <Timmy public key> OP_CHECKSIGVERIFY`
const output = new Script();
output.pushSym('OP_IF');
output.pushSym('OP_SHA256');
output.pushData(hash);
output.pushSym('OP_EQUALVERIFY');
output.pushData(ChrisPubKey);
output.pushSym('OP_CHECKSIGVERIFY');
output.pushSym('OP_ELSE');
output.pushInt(1);
output.pushSym('OP_CHECKLOCKTIMEVERIFY');
output.pushData(TimmyPubKey);
output.compile();
console.log("Output script: ", output.toString());

// `<Timmy signature> <0>`
const inputRefund = new Script();
inputRefund.pushData(TimmyPubKey);
inputRefund.pushInt(1);
inputRefund.compile();

// `<Chris signature> <S> <1> `
const inputSwap = new Script();
inputSwap.pushData(ChrisPubKey);
inputSwap.pushData(secret);
inputSwap.pushInt(1);
inputSwap.compile();


const stackRefund = new Stack();
inputRefund.execute(stackRefund);
output.execute(stackRefund);
// Verify the script was successful in its execution:
assert(stackRefund.length === 1);
assert(stackRefund.getBool(-1) === true);

const stackSwap = new Stack();
inputSwap.execute(stackSwap);
output.execute(stackSwap);
// Verify the script was successful in its execution:
assert(stackSwap.length === 1);
assert(stackSwap.getBool(-1) === true);

