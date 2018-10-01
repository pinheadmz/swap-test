/*
* Tests all the swap.js functions against multiple blockchain libraries
*/


const Swap = require('./swap');
const network = 'main';

function testSwapLib(lib) {
  console.log('\n -- testing: ', lib)

  const swap = new Swap(lib);

  const CLTV_LOCKTIME = 10; // can't spend redeem until this height
  const TX_nLOCKTIME = 15;  // minimum height the spending tx can be mined
  const secret = swap.getSecret();
  const Timmy = swap.getKeyPair();
  const Chris = swap.getKeyPair();

  console.log('Timmy:\n', Timmy, '\nChris:\n', Chris);

  const redeemScript = swap.getRedeemScript(
    secret.hash,
    Timmy.publicKey,
    Chris.publicKey,
    CLTV_LOCKTIME
  );

  const address = swap.getAddressFromRedeemScript(redeemScript);

  console.log(
    'Swap P2SH scriptPubKey:\n',
    redeemScript.hash160().toString('hex')
  );
  console.log('Swap P2SH address:\n', address);

  const fundingTX = swap.getFundingTX(address, 50000);

  const refundScript = swap.getRefundInputScript(redeemScript);

  const refundTX = swap.getRedeemTX(
    Timmy.address,
    10000,
    fundingTX,
    0,
    redeemScript,
    refundScript,
    TX_nLOCKTIME,
    Timmy.privateKey
  );

  console.log('\nREFUND VERIFY:\n', swap.verifyMTX(refundTX));

  const swapScript = swap.getSwapInputScript(redeemScript, secret.secret);

  const refundTX2 = swap.getRedeemTX(
    Chris.address,
    10000,
    fundingTX,
    0,
    redeemScript,
    swapScript,
    TX_nLOCKTIME,
    Chris.privateKey
  );

  console.log('\nSWAP VERIFY:\n', swap.verifyMTX(refundTX2));
}

const libs = ['bcoin', 'bcash'];
for (const lib of libs){
  testSwapLib(lib);
}
