/*
* Tests the swap.js functions on active testnet:
* Script will output a funding address and wait for
* incoming tx to that address, then react immediately
* with the specified redeem transaction
*/

// set these for each test -------!!
const lib = 'bcoin';    // bcoin, bcash, hsd
const mode = 'refund';  // refund, swap
// -------------------------------!!

const {NodeClient, WalletClient} = require('bclient');
const {BloomFilter} = require('bfilter');
const Swap = require('./swap');
const network = 'testnet';

const swap = new Swap(lib);

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

let redeemScript, address, CLTV_LOCKTIME, TX_nLOCKTIME;

(async () => {
  const clientinfo = await client.getInfo();
  const currentHeight = clientinfo.chain.height;
  console.log('Current chain height:\n', currentHeight);

  CLTV_LOCKTIME = currentHeight; // can't spend redeem until this height
  TX_nLOCKTIME = currentHeight;  // minimum height the spending tx can be mined

  console.log('Timmy:\n', Timmy, '\nChris:\n', Chris);

  redeemScript = swap.getRedeemScript(
    secret.hash,
    Timmy.publicKey,
    Chris.publicKey,
    CLTV_LOCKTIME
  );

  const addrFromScript = swap.getAddressFromRedeemScript(redeemScript);
  const address = addrFromScript.toString(network);

  console.log(
    'Swap P2SH scriptPubKey:\n',
    redeemScript.hash160().toString('hex')
  );
  console.log('Swap P2SH address:\n', address);

  const walletName = address.substr(address.length-40);
  await wallet.createWallet(walletName, {watchOnly: true});
  
  const watchWallet = wallet.wallet(walletName);
  await watchWallet.importAddress('default', address);
  
  const watchWalletInfo = await watchWallet.getInfo();
  console.log('Watch-only wallet created:\n', watchWalletInfo);

  await wallet.open();
  await wallet.join(walletName, watchWalletInfo.token);
})();


wallet.bind('tx', async (wallet, fundingTX) => {
  console.log('Funding TX Received:\n', fundingTX);

  switch (mode) {
    case 'refund': {
      const refundScript = swap.getRefundInputScript(redeemScript);
      const refundTX = swap.getRedeemTX(
        Timmy.address,
        2000,
        swap.TX.fromRaw(fundingTX.tx, 'hex'),
        0,
        redeemScript,
        refundScript,
        TX_nLOCKTIME,
        Timmy.privateKey
      );

      const finalTX = refundTX.toTX();
      const stringTX = finalTX.toRaw().toString('hex');

      console.log('Refund TX:\n', finalTX);

      const broadcastResult = await client.broadcast(stringTX);

      console.log('Broadcast TX: ', broadcastResult);
      break;
    }
    case 'swap': {
      const swapScript = swap.getSwapInputScript(redeemScript, secret.secret);
      const swapTX = swap.getRedeemTX(
        Chris.address,
        2000,
        swap.TX.fromRaw(fundingTX.tx, 'hex'),
        0,
        redeemScript,
        swapScript,
        TX_nLOCKTIME,
        Chris.privateKey
      );

      const finalTX = swapTX.toTX();
      const stringTX = finalTX.toRaw().toString('hex');

      console.log('Swap TX:\n', finalTX);

      const broadcastResult = await client.broadcast(stringTX);

      console.log('Broadcast TX: ', broadcastResult);
      break;
    }
  }

});

