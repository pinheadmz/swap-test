/*
* Run cross-chain atomic swap!
*/

// Requirements
const {NodeClient, WalletClient} = require('bclient');
const {BloomFilter} = require('bfilter');
const {base58} = require('bstring');
const Config = require('bcfg');
const Swap = require('./swap');

// Load command line arguments
const config = new Config('bswap'); // some module name required but we ignore
config.load({argv: true});

// Required arguments
const mine = config.str('mine');
const theirs = config.str('theirs');
const have = config.str('have');
const want = config.str('want');
const mode = config.str('mode');
// Optional arguments with defaults
const gracePeriod = config.uint('gracePeriod', 10);
const network = config.str('network', 'testnet');

// Convert base58 strings back into JSON objects
const myObject = JSON.parse(base58.decode(mine));
const theirObject = JSON.parse(base58.decode(theirs));

// Check all the parameters in the base58-encoded JSON objects
if (typeof(myObject.privateKey) !== 'string'
  || typeof(myObject.publicKey) !== 'string')
  || typeof(myObject.secret) !== 'string')
  || typeof(myObject.hash) !== 'string'){
  throw new Error ('Bad mine');
}

if (myObject.privateKey.length !== 64)
  throw new Error ('Bad mine: privateKey size');
  
if (myObject.publicKey.length !== 66)
  throw new Error ('Bad mine: publicKey size');  

if (myObject.secret.length !== 64)
  throw new Error ('Bad mine: secret size');  

if (myObject.hash.length !== 64)
  throw new Error ('Bad mine: hash size');

if (typeof(theirObject.publicKey) !== 'string'
  || typeof(theirObject.hash) !== 'string'){
  throw new Error ('Bad theirs');
}

if (theirObject.publicKey.length !== 66)
  throw new Error ('Bad theirs: publicKey size');

if (theirObject.hash.length !== 64)
  throw new Error ('Bad theirs: hash size');

const supportedLibs = ['bcoin', 'bcash'];
if (supportedLibs.indexOf(have) === -1
    || supportedLibs.indexOf(want) === -1
    || have === want){
  throw new Error('Bad have / want');
}

const supportedModes = ['start', 'refund', 'swap'];
if (supportedModes.indexOf(mode) === -1) {
  throw new Error('Bad mode');
}

// Setup clients
const ports = {
  bcoin: {nodePort: 18332, walletPort: 18334},
  bcash: {nodePort: 18032, walletPort: 18034}
}

const haveClient = new NodeClient({
  network: network
  port: ports[have].nodePort,
  apiKey: 'api-key'
});

const haveWallet = new WalletClient({
  network: network,
  port: ports[have].walletPort,
  apiKey: 'api-key'
});

const wantClient = new NodeClient({
  network: network
  port: ports[want].nodePort,
  apiKey: 'api-key'
});

const wantWallet = new WalletClient({
  network: network,
  port: ports[want].walletPort,
  apiKey: 'api-key'
});

// Load blockchain libraries
const haveSwap = new Swap(have);
const wantSwap = new Swap(want);

switch (mode){
  // Initiate the swap by funding the HTLC address on "my" chain
  case 'start': {
    let redeemScript, address, CLTV_LOCKTIME, TX_nLOCKTIME;

    (async () => {
      const clientinfo = await haveClient.getInfo();
      const currentHeight = clientinfo.chain.height;

      // Can't spend redeem until this height
      CLTV_LOCKTIME = currentHeight;
      // Minimum height the refund tx can be mined
      TX_nLOCKTIME = currentHeight + gracePeriod;

      // Build the P2SH address with the HTLC script
      redeemScript = haveSwap.getRedeemScript(
        myObject.hash,
        myObject.publicKey,
        theirObject.publicKey,
        CLTV_LOCKTIME
      );

      const addrFromScript = haveSwap.getAddressFromRedeemScript(redeemScript);
      const address = addrFromScript.toString(network);

      console.log('Swap P2SH address:\n', address);
      
      // TODO: fund swap address from primary wallet and report
      console.log('Swap-funding TX:\n', fundingTX);

      // TODO: Create a wallet on the "want" chain to watch for secret
      
    })();


    break;
  }





}















