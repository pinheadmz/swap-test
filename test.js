const Swap = require('./swap');
const network = 'main';


//const BCH = new Swap('bcash');
const BTC = new Swap('bcoin');


const CLTV_LOCKTIME = 10; // can't spend redeem until this height
const TX_nLOCKTIME = 15;  // minimum height the spending tx can be mined
const secret = BTC.getSecret();
const Timmy = BTC.getKeyPair();
const Chris = BTC.getKeyPair();

const redeemScript = BTC.getRedeemScript(
  secret.hash,
  Timmy.publicKey,
  Chris.publicKey,
  CLTV_LOCKTIME
);

const address = BTC.getAddressFromRedeemScript(redeemScript);

const fundingTX = BTC.getFundingTX(address, 50000);

const refundScript = BTC.getRefundInputScript(redeemScript);

const refundTX = BTC.getRedeemTX(
  Timmy.address,
  10000,
  fundingTX,
  0,
  redeemScript,
  refundScript,
  TX_nLOCKTIME,
  Timmy.privateKey
);

console.log('\naddress:\n', address);
console.log('\nfundingTX:\n', fundingTX);
console.log('\nrefundScript:\n', refundScript);
console.log('\nrefundTX:\n', refundTX);


console.log('\vVERIFY:\n', BTC.verifyMTX(refundTX));









/*
const {NodeClient, WalletClient} = require('bclient');


this.BTCnode = new NodeClient({
  network: 'testnet',
  port: 18332,
  apiKey: 'api-key'
});

this.BCHnode = new NodeClient({
  network: 'testnet',
  port: 18032,
  apiKey: 'api-key'
});

this.BTCwalletClient = new WalletClient({
  network: 'testnet',
  port: 18334,
  apiKey: 'api-key'
});

this.BCHwalletClient = new WalletClient({
  network: 'testnet',
  port: 18034,
  apiKey: 'api-key'
});

this.BTCwallet = this.BTCwalletClient.wallet('primary');
this.BCHwallet = this.BCHwalletClient.wallet('primary');

async nodeStatus() {
  const BTCinfo = await this.BTCnode.getInfo();
  const BCHinfo = await this.BCHnode.getInfo();

  return {
    'BTCnodeStatus': BTCinfo.chain,
    'BCHnodeStatus': BCHinfo.chain
  }
}
*/