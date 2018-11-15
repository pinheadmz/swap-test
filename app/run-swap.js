/**
 * Run cross-chain atomic swap.
 * WARNING: Running this script will send transactions and spend coins!
 */

// Requirements
const {NodeClient, WalletClient} = require('bclient');
const {base58} = require('bstring');
const Config = require('bcfg');
const Swap = require('../lib/swap');
const Xrate = require('../lib/xrate');

// Load command line arguments
const config = new Config('bswap'); // module name required but it's ignored
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
const fee = config.uint('fee', 1000);
const network = config.str('network', 'testnet');
const refund = config.bool('refund', false);
const tolerance = config.float('tolerance', 0.05); // tolerance on exchange rate

// Quick usage check
if (!mine || !theirs || !have || !want || !mode || !amount)
  err(
    'Usage:\n' +
    '  node run-swap.js --mine=<prep-swap PRIVATE output> \\ \n' +
    '  --theirs=<prep-swap PUBLIC from counterparty> \\ \n' +
    '  --have=<bcoin|bcash> --want=<bcoin|bcash> \\ \n' +
    '  --mode=<swap|sweep>  --amount=<in satoshis>\\ \n' +
    ' (optional, more in README.md): \n' +
    '  --refund=true --passphrase=<have-coin wallet PASSPHRASE>');

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

const supportedModes = ['start', 'swap'];
if (supportedModes.indexOf(mode) === -1) {
  err('Bad mode: must be "start" or "swap"');
}

// Load blockchain libraries
const haveSwap = new Swap(have, network);
const wantSwap = new Swap(want, network);

// Derive the necessary public strings from private key and secret
// Using the "have" library here but it could be either for this step
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

// Open wallet and node sockets
(async () => {
  wantWallet.open();
  haveWallet.open();
  wantClient.open();
  haveClient.open();
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

      // Refund path
      if (refund){
        await getRefund(
          haveAddress,
          haveRedeemScript,
          haveWatchWallet,
          cancelTime
        );
        return;
      }

      // TODO: check if funding TX was already sent in a previous run
      // Get primary or user-selected wallet and send to swap P2SH address
      const haveFundingWallet = haveWallet.wallet(walletID);
      const haveFundingTX = await haveFundingWallet.send({
        accout: walletAcct,
        passphrase: passphrase,
        outputs: [{ value: amount, address: haveAddress }]
      });
      console.log(have + ' funding TX sent:\n', haveFundingTX.hash);
      console.log('...with HTLC secret:\n', myObject.secret);

      // Wait for counterparty TX and sweep it, using our hash's SECRET
      wantWallet.bind('confirmed', async (wallet, txDetails) => {

        // TODO: check for counterparty refund before revealing secret
        // Get details from counterparty's TX
        const wantFundingTX = wantSwap.TX.fromRaw(txDetails.tx, 'hex');
        const fundingOutput = wantSwap.extractOutput(
          wantFundingTX,
          wantAddress
        );
        if (!fundingOutput) {
          // If wantFundingTX doesn't have the P2SH address as an output,
          // that means it has the address in its input, meaning this TX
          // is actually our own, sweeping the coin
          console.log(want + ' swap-sweep TX confirmed');
          return;
        } else {
          console.log(want + ' funding TX confirmed:\n', txDetails.hash);
          console.log(want + ' funding TX output:\n', fundingOutput);
        }

        // Check counterparty's sent amount against our amount and exchange rate
        const xrate = new Xrate({
          have: have,
          want: want,
          receivedAmount: fundingOutput.amount
        });
        const swapAmt = await xrate.getSwapAmt();
        const xRateErr = Math.abs(amount - swapAmt) / amount;
        if (tolerance < xRateErr) {
          console.log(
            'Counterparty sent wrong amount.\n' +
            'Waiting for new tx (or ctrl+c and --refund to cancel)'
          );
          return;
        }

        // Create a TX on "want" chain to sweep counterparty's output
        // First, get a primary (or user-sepcified) wallet address to receive
        const wantReceivingWallet = wantWallet.wallet(walletID);
        const sweepToAddr = 
          await wantReceivingWallet.createAddress(walletAcct);

        // Generate the input script and TX to redeem the HTLC
        const swapScript = wantSwap.getSwapInputScript(
          wantRedeemScript,
          myObject.secret
        );
        const swapTX = wantSwap.getRedeemTX(
          sweepToAddr.address,
          fee,
          wantFundingTX,
          fundingOutput.index,
          wantRedeemScript,
          swapScript,
          null,
          myObject.privateKey
        );

        // Finalize and serialize the transaction
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

      // Refund path
      if (refund){
        await getRefund(
          haveAddress,
          haveRedeemScript,
          haveWatchWallet,
          swapTime
        );
        return;
      }

      // This mode requires two wallet event listeners, so we need to
      // initialize these variables in a braoder scope
      let startTX = null;
      let startTXoutput = null;

      // Wait for counterparty TX before posting our own
      wantWallet.bind('confirmed', async (wallet, txDetails) => {

        // TODO: check for counterparty refund before sending anything
        // Get details from counterparty's TX
        startTX = wantSwap.TX.fromRaw(txDetails.tx, 'hex');
        startTXoutput = wantSwap.extractOutput(
          startTX,
          wantAddress
        );
        if (!startTXoutput) {
          // If startTX doesn't have the P2SH address in an output,
          // that means the address is in the input, meaning this TX
          // us actually our own, sweeping the coin
          console.log(want + ' swap-sweep TX confirmed');
          return;
        } else {
          console.log(want + ' funding TX confirmed:\n', txDetails.hash);
          console.log(want + ' funding TX output:\n', startTXoutput);
        }

        // Check counterparty's sent amount against our amount and exchange rate
        const xrate = new Xrate({
          have: have,
          want: want,
          receivedAmount: startTXoutput.amount
        });
        const swapAmt = await xrate.getSwapAmt();
        const xRateErr = Math.abs(amount - swapAmt) / amount;
        if (tolerance < xRateErr) {
          console.log(
            'Counterparty sent wrong amount.\n' +
            'Waiting for new tx (or ctrl+c and --refund)'
          );
          return;
        }

        // Get primary or user-selected wallet and send to swap P2SH address
        const haveFundingWallet = haveWallet.wallet(walletID);
        const haveFundingTX = await haveFundingWallet.send({
          passphrase: passphrase,
          outputs: [{ value: amount, address: haveAddress }]
        });
        console.log(have + ' funding TX sent:\n', haveFundingTX.hash);
      });

      // Watch our own "have" TX and wait for counterparty to sweep it
      haveWallet.bind('confirmed', async (wallet, txDetails) => {

        // Get details from counterparty's TX
        const haveSwapTX = haveSwap.TX.fromRaw(txDetails.tx, 'hex');
        const revealedSecret = haveSwap.extractSecret(
          haveSwapTX,
          haveAddress
        );
        if (!revealedSecret){
          // If haveSwapTX does not have the P2SH address in the input,
          // that means the address is in an output, meaning that this TX
          // is our own, funding the swap.
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
        // First, get a primary (or user-sepcified) wallet address to receive
        const wantReceivingWallet = wantWallet.wallet(walletID);
        const sweepToAddr =
          await wantReceivingWallet.createAddress(walletAcct);

        // Generate the input script and TX to redeem the HTLC
        const swapScript = wantSwap.getSwapInputScript(
          wantRedeemScript,
          revealedSecret
        );
        const swapTX = wantSwap.getRedeemTX(
          sweepToAddr.address,
          fee,
          startTX,
          startTXoutput.index,
          wantRedeemScript,
          swapScript,
          null,
          myObject.privateKey
        );

        // Finalize and serialize the transaction
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

/**
 * Common function for both modes
 * Creates HTLC scripts, derives P2SH addresses
 * and creates watch-only wallets for both chains
 */

async function createHTLC(hash, haveTimelock, wantTimelock) {
  // *** HAVE ***
  // Generate redeem script and P2SH address
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

  // Create watch-only wallet if doesn't already exist
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
  // Generate redeem script and P2SH address
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

  // Create watch-only wallet it doesn't already exist
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

/**
 * Common function for both modes
 * Creates input script and transaction to refund from the HTLC
 * Checks network mean time for every new block until time lock
 * is expired, then broadcasts the refund TX
 */

async function getRefund(
  haveAddress,
  haveRedeemScript,
  haveWatchWallet,
  locktime
) {
  // Get all transactions paying to our P2SH address
  const txs = await haveWatchWallet.getHistory('default');
  let found = false;
  // TODO: sweep wallet with one big tx instead of one refund at a time
  for (const tx of txs){
    const fundingTX = haveSwap.TX.fromRaw(tx.tx, 'hex');

    // Check if the tx is a send or receive from the P2SH address
    // We can only refund the coins sent TO the address
    const {index} = haveSwap.extractOutput(fundingTX, haveAddress);
    if (index === false)
      continue;
    found = true;

    // Get the network mean time at which the TX was confirmed
    const confBlock = tx.block;
    if (confBlock < 1)
      err('Funding TX not yet confirmed');
    const confBlockHeader =
      await haveClient.execute('getblockheader', [confBlock, 1]);
    const confTime = confBlockHeader.mediantime;
    const minRedeemTime = confTime + locktime;

    // Get a receiving address from primary wallet to sweep funds to
    const haveReceivingWallet = haveWallet.wallet(walletID);
    const sweepToAddr =
      await haveReceivingWallet.createAddress(walletAcct);

    // Generate input script and TX to redeem the refund from the HTLC
    const haveRefundScript = haveSwap.getRefundInputScript(haveRedeemScript);
    const refundTX = haveSwap.getRedeemTX(
      sweepToAddr.address,
      fee,
      fundingTX,
      index,
      haveRedeemScript,
      haveRefundScript,
      locktime,
      myObject.privateKey
    );

    // Finalize and serialize the transaction
    const finalTX = refundTX.toTX();
    const stringTX = finalTX.toRaw().toString('hex');
    console.log(have + ' refund TX:\n', finalTX.txid());

    // Get the current network mean time from the latest block
    const tipHash = await haveClient.execute('getbestblockhash');
    const tipHeader =
      await haveClient.execute('getblockheader', [tipHash, 1]);
    const tipMTP = tipHeader.mediantime;

    // Check if time lock has already expired, if so: broadcast and we're done
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

    // Check every block for updated network mean time
    haveClient.bind('chain connect', async (block) => {
      const blockEntry = haveSwap.ChainEntry.fromRaw(block);
      const blockHash = blockEntry.rhash();
      const blockHeader =
        await haveClient.execute('getblockheader', [blockHash, 1]);
      const mtp = blockHeader.mediantime;

      // If time lock has expired, broadcast the refund TX and we're done
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

/**
 * Determine if node is full/pruned or SPV
 */

async function isSPV(nodeClient){
  try {
    const blockByHeight = await nodeClient.getBlock(0);
  } catch (e) {
    return true;
  }
  return false;
}

/**
 * Rescan last 100 blocks on full/prune node, or reset if SPV
 */

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

/**
 * Utility for clean error output
 */

function err(msg){
  console.log(msg);
  process.exit();
}
