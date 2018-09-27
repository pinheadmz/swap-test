const {NodeClient, WalletClient} = require('bclient');
const {BloomFilter} = require('bfilter');
const Swap = require('./swap');
const network = 'testnet';

const swap = new Swap('bcash');

const client = new NodeClient({
  network: 'testnet',
  port: 18032,
  apiKey: 'api-key'
});

const wallet = new WalletClient({
  network: 'testnet',
  port: 18034,
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

  const address = swap.getAddressFromRedeemScript(redeemScript).toString(network);

  console.log('Swap P2SH scriptPubKey:\n', redeemScript.hash160().toString('hex'));
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

  const REFUND = true; // or SWAP

  if (REFUND) {
    // REFUND TX
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
  } else {
    // SWAP TX
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
  }


});

