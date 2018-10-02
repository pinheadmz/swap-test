/*!
 * Run cross-chain atomic swap.
 * WARNING: Running this script will send transactions and spend coins!
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
const amount = config.uint('amount');
// Optional arguments with defaults
const swapTime = config.uint('swap-time', 6);
const cancelTime = config.uint('cancel-time', 100);
const feeRate = config.uint('rate', 1000);
const network = config.str('network', 'testnet');

// Quick usage check
if (!mine || !theirs || !have || !want || !mode || !amount)
  err(
    'Usage:\n' +
    '  node run-swap.js --mine=<prep-swap PRIVATE output> \\ \n' +
    '  --theirs=<prep-swap PUBLIC from counterparty> \\ \n' +
    '  --have=<bcoin|bcash> --want=<bcoin|bcash> \\ \n' +
    '  --amount=<in satoshis>');

// Convert base58 strings back into JSON objects
const myObject = JSON.parse(base58.decode(mine));
const theirObject = JSON.parse(base58.decode(theirs));

// Check all the parameters in the base58-encoded JSON objects
if (typeof(myObject.privateKey) !== 'string'
    || typeof(myObject.secret) !== 'string') {
  err ('Bad mine');
}

if (myObject.privateKey.length !== 64)
  err ('Bad mine: privateKey size');

if (myObject.secret.length !== 64)
  err ('Bad mine: secret size');  

if (typeof(theirObject.publicKey) !== 'string'
    || typeof(theirObject.hash) !== 'string') {
  err ('Bad theirs');
}

if (theirObject.publicKey.length !== 66)
  err ('Bad theirs: publicKey size');

if (theirObject.hash.length !== 64)
  err ('Bad theirs: hash size');

const supportedLibs = ['bcoin', 'bcash'];
if (supportedLibs.indexOf(have) === -1
    || supportedLibs.indexOf(want) === -1
    || have === want) {
  err('Bad have / want: must be different, "bcoin" or "bcash"');
}

const supportedModes = ['start', 'refund', 'swap'];
if (supportedModes.indexOf(mode) === -1) {
  err('Bad mode: must be "start" "refund" or "swap"');
}

// Load blockchain libraries
const haveSwap = new Swap(have);
const wantSwap = new Swap(want);

// Derive the necessary public strings from privates
// using the "have" library here but it could be either for this step
myObject.publicKey = haveSwap.getKeyPair(myObject.privateKey).publicKey;
myObject.hash = haveSwap.getSecret(myObject.secret).hash;

// Setup clients
const ports = {
  bcoin: {nodePort: 18332, walletPort: 18334},
  bcash: {nodePort: 18032, walletPort: 18034}
}

const haveClient = new NodeClient({
  network: network,
  port: ports[have].nodePort,
  apiKey: 'api-key'
});

const haveWallet = new WalletClient({
  network: network,
  port: ports[have].walletPort,
  apiKey: 'api-key'
});

const wantClient = new NodeClient({
  network: network,
  port: ports[want].nodePort,
  apiKey: 'api-key'
});

const wantWallet = new WalletClient({
  network: network,
  port: ports[want].walletPort,
  apiKey: 'api-key'
});

switch (mode){
  // ** START ** Initiate the swap by funding the HTLC address on "my" chain
  case 'start': {
    // Initialize variables we also need in the event listener
    let refundScript, address, CLTV_LOCKTIME, TX_nLOCKTIME;

    (async () => {
      // Calculate locktimes
      const clientinfo = await haveClient.getInfo();
      const currentHeight = clientinfo.chain.height;

      // Can't spend UTXO until this height
      CLTV_LOCKTIME = currentHeight  + cancelTime;
      // Minimum height the funding tx can be mined (immediately)
      TX_nLOCKTIME = currentHeight;

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
      
      // Fund swap address from primary wallet and report



     // console.log('Swap-funding TX:\n', fundingTX);

      // TODO: Create a wallet on the "want" chain to watch for secret
      
    })();


    break;
  }
}

function err(msg){
  console.log(msg);
  process.exit();
}















