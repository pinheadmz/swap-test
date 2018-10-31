/*!
 * Run cross-chain atomic swap.
 * WARNING: Running this script will send transactions and spend coins!
 */

// Requirements
const {NodeClient, WalletClient} = require('bclient');
const {base58} = require('bstring');
const Config = require('bcfg');
const Swap = require('../lib/swap');

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
const passphrase = config.str('passphrase', '');

// Optional arguments with defaults
const walletAcct = config.str('account', 'default');
const walletID = config.str('wallet', 'primary');
const swapTime = config.uint('swap-time', 60 * 60); // 1 hour to swap
const cancelTime = config.uint('cancel-time', 60 * 60 * 24); // 1 day to cancel
const feeRate = config.uint('rate', 1000);
const network = config.str('network', 'testnet');

// Quick usage check
if (!mine || !theirs || !have || !want || !mode || !amount)
  err(
    'Usage:\n' +
    '  node run-swap.js --mine=<prep-swap PRIVATE output> \\ \n' +
    '  --theirs=<prep-swap PUBLIC from counterparty> \\ \n' +
    '  --have=<bcoin|bcash> --want=<bcoin|bcash> \\ \n' +
    '  --amount=<in satoshis> --passphrase=<have-coin PASSPHRASE>');

// Convert base58 strings back into JSON objects
const myObject = JSON.parse(base58.decode(mine));
const theirObject = JSON.parse(base58.decode(theirs));

// Check all the parameters in the base58-encoded JSON objects
if (typeof myObject.privateKey !== 'string'
    || typeof myObject.secret !== 'string') {
  err ('Bad mine');
}

if (myObject.privateKey.length !== 64)
  err ('Bad mine: privateKey size');

if (myObject.secret.length !== 64)
  err ('Bad mine: secret size');

if (typeof theirObject.publicKey !== 'string'
    || typeof theirObject.hash !== 'string') {
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
const haveSwap = new Swap(have, network);
const wantSwap = new Swap(want, network);

// Derive the necessary public strings from privates.
// Using the "have" library here but it could be either for this step.
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

// open wallet DBs
(async () => {
  wantWallet.open();
  haveWallet.open();
})();

switch (mode){
  // ** START ** Initiate the swap by funding the HTLC address on "have" chain
  case 'start': {
    (async () => {
      // Create P2SH addresses and watch-only wallets for both chains
      const {
        wantRedeemScript,
        wantAddress,
        haveAddress
      } = await createHTLC(myObject.hash, cancelTime, swapTime);

      // SEND COINS! Fund swap address from primary wallet and report
      const haveFundingWallet = haveWallet.wallet(walletID);
      const fundingTX = await haveFundingWallet.send({
        passphrase: passphrase,
        outputs: [{ value: amount, address: haveAddress }]
      });
      console.log(have + ' funding TX sent:\n', fundingTX.hash);
      console.log('...with HTLC secret:\n', myObject.secret);

      // Wait for counterparty TX and sweep it, using our hash's SECRET
      wantWallet.bind('tx', async (wallet, txDetails) => {
        // Get details from counterparty's TX
        // TODO: check amount and wait for confirmation for safety
        const fundingTX = wantSwap.TX.fromRaw(txDetails.tx, 'hex');
        const fundingOutput = wantSwap.extractOutput(
          fundingTX,
          wantAddress
        );
        if (!fundingOutput) {
          console.log(want + ' swap-sweep TX received');
          return;
        } else {
          console.log(want + ' funding TX received:\n', txDetails.hash);
          console.log(want + ' funding TX output:\n', fundingOutput);
        }

        // Create a TX on "want" chain to sweep counterparty's output
        const wantReceivingWallet = wantWallet.wallet(walletID);
        const sweepToAddr = 
          await wantReceivingWallet.createAddress(walletAcct);
        const swapScript = wantSwap.getSwapInputScript(
          wantRedeemScript,
          myObject.secret
        );
        const swapTX = wantSwap.getRedeemTX(
          sweepToAddr.address,
          feeRate,
          fundingTX,
          fundingOutput.index,
          wantRedeemScript,
          swapScript,
          null,
          myObject.privateKey
        );
        const finalTX = swapTX.toTX();
        const stringTX = finalTX.toRaw().toString('hex');
        console.log(want + ' swap-sweep address:\n', sweepToAddr.address);
        console.log(want + ' swap-sweep TX:\n', swapTX.txid());

        // Broadcast swap-sweep TX, we're done!
        const broadcastResult = await wantClient.broadcast(stringTX);
        console.log(want + ' broadcasting swap TX: ', broadcastResult);
        process.exit();
      });
    })();
    break;
  }

  // ** SWAP ** Accept swap by posting TX with HTLC and wait for secret
  case 'swap': {
    (async () => {
      // Create P2SH addresses and watch-only wallets for both chains
      const {
        wantRedeemScript,
        haveRedeemScript,
        wantAddress,
        haveAddress
      } = await createHTLC(theirObject.hash, swapTime, cancelTime);

      let startTX = null;
      let startTXoutput = null;

      // Wait for counterparty TX before posting our own
      wantWallet.bind('tx', async (wallet, txDetails) => {
        // Get details from counterparty's TX
        // TODO: check amount and wait for confirmation for safety
        startTX = wantSwap.TX.fromRaw(txDetails.tx, 'hex');
        startTXoutput = wantSwap.extractOutput(
          startTX,
          wantAddress
        );
        if (!startTXoutput) {
          console.log(want + ' swap-sweep TX received');
          return;
        } else {
          console.log(want + ' funding TX received:\n', txDetails.hash);
          console.log(want + ' funding TX output:\n', startTXoutput);
        }

        // SEND COINS! Fund swap address from primary wallet and report
        const haveFundingWallet = haveWallet.wallet(walletID);
        const fundingTX = await haveFundingWallet.send({
          passphrase: passphrase,
          outputs: [{ value: amount, address: haveAddress }]
        });
        console.log(have + ' funding TX sent:\n', fundingTX.hash);
      });

      // Watch our own "have" TX and wait for counterparty to sweep it
      haveWallet.bind('tx', async (wallet, txDetails) => {
        // Get details from counterparty's TX
        // TODO: check amount and wait for confirmation for safety
        const fundingTX = haveSwap.TX.fromRaw(txDetails.tx, 'hex');

        const revealedSecret = haveSwap.extractSecret(
          fundingTX,
          haveAddress
        );
        if (!revealedSecret){
          console.log(have + ' funding TX received');
          return;
        } else {
          console.log(have + ' swap-sweep TX received:\n', txDetails.hash);
          console.log(have + ' swap-sweep TX secret revealed:\n', revealedSecret);
        }

        // Create a TX on "want" chain to sweep counterparty's output
        const wantReceivingWallet = wantWallet.wallet(walletID);
        const sweepToAddr =
          await wantReceivingWallet.createAddress(walletAcct);
        const swapScript = wantSwap.getSwapInputScript(
          wantRedeemScript,
          revealedSecret
        );
        const swapTX = wantSwap.getRedeemTX(
          sweepToAddr.address,
          feeRate,
          startTX,
          startTXoutput.index,
          wantRedeemScript,
          swapScript,
          null,
          myObject.privateKey
        );
        const finalTX = swapTX.toTX();
        const stringTX = finalTX.toRaw().toString('hex');
        console.log(want + ' swap-sweep address:\n', sweepToAddr.address);
        console.log(want + ' swap-sweep TX:\n', swapTX.txid());

        // Broadcast swap-sweep TX, we're done!
        const broadcastResult = await wantClient.broadcast(stringTX);
        console.log(want + ' broadcasting swap TX: ', broadcastResult);
        process.exit();
      });
    })();
    break;
  }
}

async function createHTLC(hash, haveTimelock, wantTimelock) {
  // Build the "have" P2SH address with the HTLC script and LONG timelock
  const haveRedeemScript = haveSwap.getRedeemScript(
    hash,
    myObject.publicKey,
    theirObject.publicKey,
    haveTimelock
  );

  const haveAddrFromScript =
    haveSwap.getAddressFromRedeemScript(haveRedeemScript);
  const haveAddress = haveAddrFromScript.toString(network);
  console.log(have + ' P2SH address:\n', haveAddress);

  // create a watch-only wallet in case we need to self-refund
  // TODO: if wallet already exists, that's ok
  const haveWalletName = haveSwap.nameWallet(haveAddress);
  await haveWallet.createWallet(haveWalletName, {watchOnly: true});
  const haveWatchWallet = haveWallet.wallet(haveWalletName);
  await haveWatchWallet.importAddress('default', haveAddress);
  const haveWalletInfo = await haveWatchWallet.getInfo();
  await haveWallet.join(haveWalletName, haveWalletInfo.token);
  console.log(have + ' watch-only wallet created:\n', haveWalletInfo.id);

  // Build the "want" P2SH address with HTLC and SHORT timelock
  const wantRedeemScript = wantSwap.getRedeemScript(
    hash,
    theirObject.publicKey,
    myObject.publicKey,
    wantTimelock
  );
  const wantAddrFromScript =
    wantSwap.getAddressFromRedeemScript(wantRedeemScript);
  const wantAddress = wantAddrFromScript.toString(network);
  console.log(want + ' P2SH address:\n', wantAddress);

  // create a watch-only wallet to catch counterparty's side of the trade
  // TODO: if wallet already exists, that's ok
  const wantWalletName = wantSwap.nameWallet(wantAddress);
  await wantWallet.createWallet(wantWalletName, {watchOnly: true});
  const wantWatchWallet = wantWallet.wallet(wantWalletName);
  await wantWatchWallet.importAddress('default', wantAddress);
  const watchWalletInfo = await wantWatchWallet.getInfo();
  await wantWallet.join(wantWalletName, watchWalletInfo.token);
  console.log(want + ' watch-only wallet created:\n', watchWalletInfo.id);

  // send back the addresses, used by the modes differently
  return {
    wantRedeemScript: wantRedeemScript,
    haveRedeemScript: haveRedeemScript,
    wantAddress: wantAddress,
    haveAddress: haveAddress
  }
};

function err(msg){
  console.log(msg);
  process.exit();
}
