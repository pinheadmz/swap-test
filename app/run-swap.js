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
const refund = config.bool('refund', false);

// Quick usage check
if (!mine || !theirs || !have || !want || !mode || !amount)
  err(
    'Usage:\n' +
    '  node run-swap.js --mine=<prep-swap PRIVATE output> \\ \n' +
    '  --theirs=<prep-swap PUBLIC from counterparty> \\ \n' +
    '  --have=<bcoin|bcash> --want=<bcoin|bcash> \\ \n' +
    '  --mode=<swap|sweep>  --amount=<in satoshis>\\ \n' +
    ' (optional): \n' +
    '  --refund=true --passphrase=<have-coin PASSPHRASE>');

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
        haveRedeemScript,
        wantRedeemScript,
        wantAddress,
        haveAddress,
        haveWatchWallet
      } = await createHTLC(myObject.hash, cancelTime, swapTime);

      if (refund){
        await getRefund(
          haveAddress,
          haveRedeemScript,
          haveWatchWallet,
          swapTime
        );
        return;
      }

      // SEND COINS! Fund swap address from primary wallet and report
      const haveFundingWallet = haveWallet.wallet(walletID);
      const fundingTX = await haveFundingWallet.send({
        passphrase: passphrase,
        outputs: [{ value: amount, address: haveAddress }]
      });
      console.log(have + ' funding TX sent:\n', fundingTX.hash);
      console.log('...with HTLC secret:\n', myObject.secret);

      // Wait for counterparty TX and sweep it, using our hash's SECRET
      wantWallet.bind('confirmed', async (wallet, txDetails) => {
        // Get details from counterparty's TX
        // TODO: check amount
        // TODO: check counterparty hasn't already refunded
        const fundingTX = wantSwap.TX.fromRaw(txDetails.tx, 'hex');
        const fundingOutput = wantSwap.extractOutput(
          fundingTX,
          wantAddress
        );
        if (!fundingOutput) {
          console.log(want + ' swap-sweep TX confirmed');
          return;
        } else {
          console.log(want + ' funding TX confirmed:\n', txDetails.hash);
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

      // Just in case we're "late" check last 100 blocks
      console.log(have + ' checking last 100 blocks for transactions');
      await rescan100(haveClient, haveWallet);
      console.log(want + ' checking last 100 blocks for transactions');
      await rescan100(wantClient, wantWallet);
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
        haveAddress,
        haveWatchWallet
      } = await createHTLC(theirObject.hash, swapTime, cancelTime);

      if (refund){
        await getRefund(
          haveAddress,
          haveRedeemScript,
          haveWatchWallet,
          swapTime
        );
        return;
      }

      let startTX = null;
      let startTXoutput = null;

      // Wait for counterparty TX before posting our own
      wantWallet.bind('confirmed', async (wallet, txDetails) => {
        // Get details from counterparty's TX
        // TODO: check amount
        // TODO: check counterparty hasn't already refunded
        startTX = wantSwap.TX.fromRaw(txDetails.tx, 'hex');
        startTXoutput = wantSwap.extractOutput(
          startTX,
          wantAddress
        );
        if (!startTXoutput) {
          console.log(want + ' swap-sweep TX confirmed');
          return;
        } else {
          console.log(want + ' funding TX confirmed:\n', txDetails.hash);
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
      haveWallet.bind('confirmed', async (wallet, txDetails) => {
        // Get details from counterparty's TX
        // TODO: check amount and wait for confirmation for safety
        const fundingTX = haveSwap.TX.fromRaw(txDetails.tx, 'hex');

        const revealedSecret = haveSwap.extractSecret(
          fundingTX,
          haveAddress
        );
        if (!revealedSecret){
          console.log(have + ' funding TX confirmed');
          return;
        } else {
          console.log(have + ' swap-sweep TX confirmed:\n', txDetails.hash);
          console.log(
            have + ' swap-sweep TX secret revealed:\n',
            revealedSecret
          );
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

      // Just in case we're "late" check last 100 blocks
      console.log(have + ' checking last 100 blocks for transactions');
      await rescan100(haveClient, haveWallet);
      console.log(want + ' checking last 100 blocks for transactions');
      await rescan100(wantClient, wantWallet);
    })();
    break;
  }
}

async function createHTLC(hash, haveTimelock, wantTimelock) {
  // *** HAVE ***
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

  // Get the watch-only wallet in case we need to self-refund
  const haveWalletName = haveSwap.nameWallet(haveAddress);
  const haveWatchWallet = haveWallet.wallet(haveWalletName);
  let haveWalletInfo = await haveWatchWallet.getInfo();

  // Create if doesn't already exist
  if (!haveWalletInfo) {
    console.log(have + ' watch-only wallet created:');
    haveWalletInfo =
      await haveWallet.createWallet(haveWalletName, {watchOnly: true});
    // Import address to watch
    await haveWatchWallet.importAddress('default', haveAddress);
  } else {
    console.log(have + ' watch-only wallet exists:');
  }

  // Listen for events
  await haveWallet.join(haveWalletName, haveWalletInfo.token);
  console.log(' ' + haveWalletInfo.id);

  // *** WANT ***
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

  // Get the watch-only wallet to catch counterparty's side of the trade
  const wantWalletName = wantSwap.nameWallet(wantAddress);
  const wantWatchWallet = wantWallet.wallet(wantWalletName);
  let watchWalletInfo = await wantWatchWallet.getInfo();

  // Create if it doesn't already exist
  if (!watchWalletInfo){
    console.log(want + ' watch-only wallet created:');
    watchWalletInfo =
      await wantWallet.createWallet(wantWalletName, {watchOnly: true});
    // Import address to watch
    await wantWatchWallet.importAddress('default', wantAddress);
  } else {
    console.log(want + ' watch-only wallet exists:');
  }

  // Listen for events
  await wantWallet.join(wantWalletName, watchWalletInfo.token);
  console.log(' ' + watchWalletInfo.id);

  // Send back the addresses, used by the modes differently
  return {
    wantRedeemScript: wantRedeemScript,
    haveRedeemScript: haveRedeemScript,
    wantAddress: wantAddress,
    haveAddress: haveAddress,
    haveWatchWallet: haveWatchWallet
  }
};

async function getRefund(
  haveAddress,
  haveRedeemScript,
  haveWatchWallet,
  locktime
) {
  // find transactions paying to our P2SH address
  const txs = await haveWatchWallet.getHistory('default');

  let found = false;
  for (const tx of txs){
    const fundingTX = haveSwap.TX.fromRaw(tx.tx, 'hex');
    const {index} = haveSwap.extractOutput(fundingTX, haveAddress);

    if (index === false)
      continue;

    found = true;
    // calculate locktime expiration time
    const confBlock = tx.block;

    if (confBlock < 1)
      err('Funding TX not yet confirmed');

    const confBlockHeader =
      await haveClient.execute('getblockheader', [confBlock, 1]);
    const confTime = confBlockHeader.mediantime;
    const minRedeemTime = confTime + locktime;

    // Create a TX on "want" chain to sweep counterparty's output
    const haveReceivingWallet = haveWallet.wallet(walletID);
    const sweepToAddr =
      await haveReceivingWallet.createAddress(walletAcct);
    const haveRefundScript = haveSwap.getRefundInputScript(haveRedeemScript);

    // Will create one entire tx for each coin
    // TODO: sweep wallet with one big tx
    const refundTX = haveSwap.getRedeemTX(
      sweepToAddr.address,
      feeRate,
      fundingTX,
      index,
      haveRedeemScript,
      haveRefundScript,
      locktime,
      myObject.privateKey
    );

    const finalTX = refundTX.toTX();
    const stringTX = finalTX.toRaw().toString('hex');

    console.log(have + ' refund TX:\n', finalTX.txid());

    // Maybe time has already expired?
    const tipHash = await haveClient.execute('getbestblockhash');
    const tipHeader =
      await haveClient.execute('getblockheader', [tipHash, 1]);
    const tipMTP = tipHeader.mediantime;

    if (tipMTP >= minRedeemTime){
      const tipBroadcastResult = await haveClient.broadcast(stringTX);
      console.log('Timelock expired, broadcasting TX:\n', tipBroadcastResult);
      process.exit();
    }

    // Wait for network time to expire
    console.log(
      'Waiting for locktime to expire: ',
      haveSwap.util.date(minRedeemTime)
    );

    haveClient.bind('chain connect', async (block) => {
      const blockEntry = haveSwap.ChainEntry.fromRaw(block);
      const blockHash = blockEntry.rhash();
      const blockHeader =
        await haveClient.execute('getblockheader', [blockHash, 1]);
      const mtp = blockHeader.mediantime;

      if (mtp >= minRedeemTime){
        const broadcastResult = await haveClient.broadcast(stringTX);
        console.log('Timelock expired, broadcasting TX:\n', broadcastResult);
        process.exit();
      } else {
        console.log(
          "Block received, but timelock not expired. Current time: ",
          haveSwap.util.date(mtp)
        );
      }
    });
  }
  if (!found)
    err('No refundable tx found')
}

async function isSPV(nodeClient){
  try {
    const blockByHeight = await nodeClient.getBlock(0);
  } catch (e) {
    return true;
  }
  return false;
}

async function rescan100(nodeClient, walletClient){
  const spv = await isSPV(nodeClient);
  const info = await nodeClient.getInfo();
  const height = info.chain.height - 100;

  // rescan won't work by itself in SPV mode
  if (spv) {
    await nodeClient.reset(height);
  } else {
    await walletClient.rescan(height);
  }
}

function err(msg){
  console.log(msg);
  process.exit();
}
