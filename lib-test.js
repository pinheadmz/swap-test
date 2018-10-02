/*!
 * Tests all the swap.js functions against multiple blockchain libraries.
 */

const Swap = require('./swap');
const network = 'testnet';

function testSwapLib(lib) {
  console.log('\n -- testing: ', lib)

  const swap = new Swap(lib);

  const CSV_LOCKTIME = swap.CSVencode(10, true); // can't spend redeem until this height
  const TX_nSEQUENCE = swap.CSVencode(15, true);  // minimum height the spending tx can be mined
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

  console.log(
    'Swap P2SH scriptPubKey:\n',
    redeemScript.hash160().toString('hex')
  );
  console.log('Swap P2SH address:\n', address.toString(network));

  const fundingTX = swap.getFundingTX(address, 50000);

  const refundScript = swap.getRefundInputScript(redeemScript);

  const refundTX = swap.getRedeemTX(
    Timmy.address,
    10000,
    fundingTX,
    0,
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
    0,
    redeemScript,
    swapScript,
    TX_nSEQUENCE,
    Chris.privateKey
  );

  console.log('\nSWAP VERIFY:\n', swap.verifyMTX(swapTX));

  const extractedSecret = swap.extractSecret(swapTX);
  console.log('\nExtracted HTLC secret:\n', extractedSecret);
  console.log('Secret match:\n', extractedSecret == secret.secret);

}

const libs = ['bcoin', 'bcash'];
for (const lib of libs){
  testSwapLib(lib);
}
