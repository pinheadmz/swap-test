/**
 * Create parameters for swap
 */

'use strict';

const {base58} = require('bstring');
const Swap = require('../lib/swap');

const swap = new Swap('bcoin', 'testnet');  // could be any library for this
const secret = swap.getSecret();
const keys = swap.getKeyPair();

const pub = {
  hash: secret.hash.toString('hex'),
  publicKey: keys.publicKey.toString('hex')
};
const priv = {
  secret: secret.secret.toString('hex'),
  privateKey: keys.privateKey.toString('hex')
};

// encode JSON objects into base58 strings for easy copy+paste
const pubBase58 = base58.encode(new Buffer(JSON.stringify(pub)));
const privBase58 = base58.encode(new Buffer(JSON.stringify(priv)));

console.log('\n --- \n');
console.log('PUBLIC: send to counterparty:\n', pubBase58);
console.log('\n --- \n');
console.log('PRIVATE: keep safe and pass to run script:\n', privBase58);
console.log('\n --- \n');
