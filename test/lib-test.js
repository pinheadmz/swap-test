/**
 * Tests all the swap.js functions against multiple blockchain libraries.
 */

const Swap = require('../lib/swap');
const network = 'testnet';

function testSwapLib(lib, network) {
  console.log('\n -- testing: ' + lib + ' on network: ' + network)

  // instantiate Swap object with selected library and network
  const swap = new Swap(lib, network);

  // set constants
  const hour = 60 * 60;
  const day = hour * 24;
  const CSV_LOCKTIME = 1 * hour; // can't spend redeem until this time passes
  const TX_nSEQUENCE = 2 * hour; // minimum passed time before redeem tx valid

  // Originally used "Timmy" for bTc and "CHris" for bCH
  const secret = swap.getSecret();
  const Timmy = swap.getKeyPair();
  const Chris = swap.getKeyPair();
  console.log('Timmy:\n', Timmy, '\nChris:\n', Chris, '\nSecret:\n', secret);

  // Create HTLC redeem script
  const redeemScript = swap.getRedeemScript(
    secret.hash,
    Timmy.publicKey,
    Chris.publicKey,
    CSV_LOCKTIME
  );

  // wrap redeem script in P2SH address
  const address = swap.getAddressFromRedeemScript(redeemScript);
  console.log('Swap P2SH address:\n', address.toString());

  // create a "fake coinbase" transaction to fund the HTLC
  const fundingTX = swap.getFundingTX(address, 50000);

  // make sure we can determine which UTXO funds the HTLC
  const fundingTXoutput = swap.extractOutput(fundingTX, address);
  console.log('Funding TX output:\n', fundingTXoutput);

  // create the REFUND redemption of the HTLC and test it works
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

  // create and test the SWAP redemption of the HTLC
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

  // test that we can extract the HTLC secret from the SWAP redemption
  const extractedSecret = swap.extractSecret(swapTX, address);
  console.log('\nExtracted HTLC secret:\n', extractedSecret);
  // make sure we ended up with the same secret we started with
  console.log('Secret match:\n', extractedSecret == secret.secret);
}

// Iterate through the supported libraries
const libs = ['bcoin', 'bcash'];
for (const lib of libs){
  testSwapLib(lib, network);
}
