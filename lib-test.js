/*!
 * Tests all the swap.js functions against multiple blockchain libraries.
 */

const Swap = require('./swap');
const network = 'testnet';

function testSwapLib(lib) {
  console.log('\n -- testing: ', lib)

  const swap = new Swap(lib);

  const hour = 60 * 60;
  const day = hour * 24;
  const CSV_LOCKTIME = 1 * hour; // can't spend redeem until this time passes
  const TX_nSEQUENCE = 2 * hour; // minimum passed time before redeem tx valid

  const secret = swap.getSecret();
  const Timmy = swap.getKeyPair();
  const Chris = swap.getKeyPair();

  console.log('Timmy:\n', Timmy, '\nChris:\n', Chris, '\nSecret:\n', secret);

  const redeemScript = swap.getRedeemScript(
    secret.hash,
    Timmy.publicKey,
    Chris.publicKey,
    CSV_LOCKTIME
  );

  const address = swap.getAddressFromRedeemScript(redeemScript);

  console.log('Swap P2SH address:\n', address.toString(network));

  const fundingTX = swap.getFundingTX(address, 50000);

  const fundingTXoutput = swap.extractOutput(fundingTX, address, network);
  console.log('Funding TX output:\n', fundingTXoutput);

  const refundScript = swap.getRefundInputScript(redeemScript);

  const refundTX = swap.getRedeemTX(
    Timmy.address,
    10000,
    fundingTX,
    fundingTXoutput.index,
    redeemScript,
    refundScript,
    TX_nSEQUENCE,
    Timmy.privateKey
  );

  console.log('\nREFUND VERIFY:\n', swap.verifyMTX(refundTX));

  const swapScript = swap.getSwapInputScript(redeemScript, secret.secret);

  const swapTX = swap.getRedeemTX(
    Chris.address,
    10000,
    fundingTX,
    fundingTXoutput.index,
    redeemScript,
    swapScript,
    null,
    Chris.privateKey
  );

  console.log('\nSWAP VERIFY:\n', swap.verifyMTX(swapTX));

  const extractedSecret = swap.extractSecret(swapTX, redeemScript);
  console.log('\nExtracted HTLC secret:\n', extractedSecret);
  console.log('Secret match:\n', extractedSecret == secret.secret);
}

const libs = ['bcoin', 'bcash'];
for (const lib of libs){
  testSwapLib(lib);
}
