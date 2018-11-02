/*!
 * Tests the swap.js functions on active testnet:
 * Script will output a funding address and wait for
 * incoming tx to that address, then react immediately
 * with the specified redeem transaction, all on one chain only.
 */

const {NodeClient, WalletClient} = require('bclient');
const Swap = require('../lib/swap');
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

const secret = swap.getSecret();
const Timmy = swap.getKeyPair();
const Chris = swap.getKeyPair();

let redeemScript, address, CLTV_LOCKTIME, TX_nSEQUENCE;

(async () => {
  console.log('Is this an SPV node?\n', await isSPV(client));

  CLTV_LOCKTIME = 60 * 10; // can't spend redeem until ten minutes pass
  TX_nSEQUENCE = 60 * 10;  // minimum height the funding tx can be mined

  console.log('Timmy:\n', Timmy, '\nChris:\n', Chris);

  redeemScript = swap.getRedeemScript(
    secret.hash,
    Timmy.publicKey,
    Chris.publicKey,
    CLTV_LOCKTIME
  );

  const addrFromScript = swap.getAddressFromRedeemScript(redeemScript);
  address = addrFromScript.toString(network);

  console.log(
    'Swap P2SH scriptPubKey:\n',
    redeemScript.hash160().toString('hex')
  );
  console.log('Swap P2SH address:\n', address);

  const walletName = swap.nameWallet(address);
  await wallet.createWallet(walletName, {watchOnly: true});
  
  const watchWallet = wallet.wallet(walletName);
  await watchWallet.importAddress('default', address);
  
  const watchWalletInfo = await watchWallet.getInfo();
  console.log('Watch-only wallet created:\n', watchWalletInfo);

  await client.open();
  await wallet.open();
  await wallet.join(walletName, watchWalletInfo.token);
})();

switch (mode) {
  case 'refund': {
    wallet.bind('confirmed', async (wallet, fundingTX) => {

      const confBlock = fundingTX.block;
      const confBlockHeader = await client.execute('getblockheader', [confBlock, 1]);
      const confTime = confBlockHeader.mediantime;
      const minRedeemTime = confTime + CLTV_LOCKTIME;

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

      const finalTX = refundTX.toTX();
      const stringTX = finalTX.toRaw().toString('hex');

      console.log('Funding confirmed, refund TX:\n', finalTX);

      // wait twenty network minutes and broadcast
      console.log('Waiting for locktime to expire: ', swap.util.date(minRedeemTime))

      client.bind('chain connect', async (block) => {
        const blockEntry = swap.ChainEntry.fromRaw(block);
        const blockHash = blockEntry.rhash();
        const blockHeader = await client.execute('getblockheader', [blockHash, 1]);
        const mtp = blockHeader.mediantime;

        if (mtp >= minRedeemTime){
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
  case 'swap': {
    wallet.bind('tx', async (wallet, txDetails) => {
      // Get details from counterparty's TX
      // TODO: check amount and wait for confirmation for safety
      const fundingTX = swap.TX.fromRaw(txDetails.tx, 'hex');
      const fundingTXoutput = swap.extractOutput(
        fundingTX,
        address
      );
      if (!fundingTXoutput) {
        console.log('TX received from unrecognized address');
        return;
      } else {
        console.log('Funding TX output:\n', fundingTXoutput);
      }
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

      const finalTX = swapTX.toTX();
      const stringTX = finalTX.toRaw().toString('hex');

      console.log('Swap TX:\n', finalTX);

      const broadcastResult = await client.broadcast(stringTX);

      console.log('Broadcast TX: ', broadcastResult);
      process.exit();
    });
    break;
  }
}

async function isSPV(nodeClient){
  try {
    const blockByHeight = await nodeClient.getBlock(0);
  } catch (e) {
    return true;
  }
  return false;
}
