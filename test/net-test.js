/**
 * Tests the swap.js functions on active testnet:
 * Script will output a funding address and wait for
 * incoming tx to that address, then react immediately
 * with the specified redeem transaction, all on one chain only.
 */

const {NodeClient, WalletClient} = require('bclient');
const Swap = require('../lib/swap');
const Xrate = require('../lib/xrate');
const Config = require('bcfg');
const network = 'testnet';

// Load command line arguments
const config = new Config('bswap'); // some module name required but we ignore
config.load({argv: true});

// Required arguments
const lib = config.str('lib');
const mode = config.str('mode');

// Quick usage check
if (!['bcoin', 'bcash'].includes(lib) ||
    !['swap', 'refund'].includes(mode)) {
  console.log(
    "Usage: $ node test/net-test.js --lib=<bcoin|bcash> --mode=<swap|refund>"
    );
  process.exit();
}

// Instantiate Swap object and clients for node and wallet
const swap = new Swap(lib, network);
const nodePort = (lib == 'bcoin') ? 18332 : 18032;
const walletPort = (lib == 'bcoin') ? 18334 : 18034;
const client = new NodeClient({
  network: 'testnet',
  port: nodePort,
  apiKey: 'api-key'
});
const wallet = new WalletClient({
  network: 'testnet',
  port: walletPort,
  apiKey: 'api-key'
});

// Generate keys and HTLC secret
const secret = swap.getSecret();
const Timmy = swap.getKeyPair();
const Chris = swap.getKeyPair();
console.log('Timmy:\n', Timmy, '\nChris:\n', Chris);

// Initialize global variables for wallet event listeners
let redeemScript, address, CLTV_LOCKTIME, TX_nSEQUENCE;

(async () => {
  // First check: SPV detection (for rescan/reset)
  console.log('Is this an SPV node?\n', await isSPV(client));

  // Set relative locktime parameters
  CLTV_LOCKTIME = 60 * 10; // can't spend redeem until ten minutes pass
  TX_nSEQUENCE = 60 * 10;  // minimum height the funding tx can be mined

  // Create HTLC redeem script
  redeemScript = swap.getRedeemScript(
    secret.hash,
    Timmy.publicKey,
    Chris.publicKey,
    CLTV_LOCKTIME
  );

  // Derive P2SH address from redeem script
  const addrFromScript = swap.getAddressFromRedeemScript(redeemScript);
  address = addrFromScript.toString(network);
  // This is the address the user must send coins to to finish test
  console.log('Swap P2SH address:\n', address);

  // Create a watch-only wallet for this address, named by the address
  const walletName = swap.nameWallet(address);
  await wallet.createWallet(walletName, {watchOnly: true});
  const watchWallet = wallet.wallet(walletName);
  await watchWallet.importAddress('default', address);
  
  // Get details of newly created wallet, specifically access token
  const watchWalletInfo = await watchWallet.getInfo();
  console.log('Watch-only wallet created:\n', watchWalletInfo);

  // Open sockets for node and wallet to listen for events
  await client.open();
  await wallet.open();
  await wallet.join(walletName, watchWalletInfo.token);
})();

// Add event listeners to wallet that react to tx confirmation depending on mode
switch (mode) {

  /**
   * REFUND
   */

  case 'refund': {
    wallet.bind('confirmed', async (wallet, fundingTX) => {

      // Get network mean time from block that confirmed the tx
      const confBlock = fundingTX.block;
      const confBlockHeader = await client.execute(
        'getblockheader',
        [confBlock, 1]
      );
      const confTime = confBlockHeader.mediantime;
      const minRedeemTime = confTime + CLTV_LOCKTIME;

      // Create the input script and transaction to refund from the HTLC
      const refundScript = swap.getRefundInputScript(redeemScript);
      const refundTX = swap.getRedeemTX(
        Timmy.address,
        2000,
        swap.TX.fromRaw(fundingTX.tx, 'hex'),
        0,
        redeemScript,
        refundScript,
        TX_nSEQUENCE,
        Timmy.privateKey
      );

      // Finish and serialize transaction
      const finalTX = refundTX.toTX();
      const stringTX = finalTX.toRaw().toString('hex');
      console.log('Funding confirmed, refund TX:\n', finalTX);

      // Wait twenty network minutes and broadcast
      console.log(
        'Waiting for locktime to expire: ',
        swap.util.date(minRedeemTime)
      );

      // Every new block we get the updated network time
      client.bind('chain connect', async (block) => {
        const blockEntry = swap.ChainEntry.fromRaw(block);
        const blockHash = blockEntry.rhash();
        const blockHeader = await client.execute(
          'getblockheader',
          [blockHash, 1]
        );
        const mtp = blockHeader.mediantime;

        // Check if the update time is sufficient to broadcast the refund
        if (mtp >= minRedeemTime){
          // If the time lock has expired, broadcast refund and we're done
          const broadcastResult = await client.broadcast(stringTX);
          console.log('Timelock expired, broadcasting TX:\n', broadcastResult);
          process.exit();
        } else {
          console.log(
            "Block received, timelock not expired. Current time: ",
            swap.util.date(mtp)
          );
        }
      });
    });
    break;
  }

  /**
   * SWAP
   */

  case 'swap': {
    wallet.bind('confirmed', async (wallet, txDetails) => {

      // Get details from counterparty's TX
      const fundingTX = swap.TX.fromRaw(txDetails.tx, 'hex');
      const fundingTXoutput = swap.extractOutput(
        fundingTX,
        address
      );

      // If the transaction doesn't have an output to the P2SH address,
      // that means the P2SH must be in an input (like when it's redeemed).
      if (!fundingTXoutput) {
        console.log('TX received from P2SH address');
        return;
      } else {
        console.log('Funding TX output:\n', fundingTXoutput);
      }

      // Test exchange rate (not used in this test)
      const want = lib;
      const have = lib === 'bcoin' ? 'bcash' : 'bcoin';
      const xrate = new Xrate({
        have: have,
        want: want,
        receivedAmount: fundingTXoutput.amount
      });
      const swapAmt = await xrate.getSwapAmt();
      console.log(
        'Exchange rate:\n  ' +
        want + ' received:   ' + fundingTXoutput.amount + '\n  ' +
        have + ' would send: ' + swapAmt
      );

      // Generate the input script and transaction to spend the HTLC output
      const swapScript = swap.getSwapInputScript(redeemScript, secret.secret);
      const swapTX = swap.getRedeemTX(
        Chris.address,
        2000,
        fundingTX,
        0,
        redeemScript,
        swapScript,
        null,
        Chris.privateKey
      );

      // Finalize and serialize transaction
      const finalTX = swapTX.toTX();
      const stringTX = finalTX.toRaw().toString('hex');
      console.log('Swap TX:\n', finalTX);

      // Broadcast to network and we're done
      const broadcastResult = await client.broadcast(stringTX);
      console.log('Broadcast TX: ', broadcastResult);
      process.exit();
    });
    break;
  }
}

/**
 * Utility - test that we can detect SPV for rescan / reset
 */


async function isSPV(nodeClient){
  try {
    const blockByHeight = await nodeClient.getBlock(0);
  } catch (e) {
    return true;
  }
  return false;
}
