/*
 * Create parameters for swap
 */

const {base58} = require('bstring');
const Swap = require('./swap');

const swap = new Swap('bcoin', 'testnet');  // could be any library for this step
const secret = swap.getSecret();
const keys = swap.getKeyPair();

const pub = {
  hash: secret.hash.toString('hex'),
  publicKey: keys.publicKey.toString('hex')
};
const priv = {
  secret: secret.secret.toString('hex'),
  privateKey: keys.privateKey.toString('hex'),
};

const pubBase58 = base58.encode(new Buffer(JSON.stringify(pub)));
const privBase58 = base58.encode(new Buffer(JSON.stringify(priv)));

console.log('\n --- \n');
console.log('PUBLIC: send to counterparty:\n', pubBase58);
console.log('\n --- \n');
console.log('PRIVATE: keep safe and pass to run script:\n', privBase58);
console.log('\n --- \n');
