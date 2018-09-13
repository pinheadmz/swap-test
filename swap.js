const {NodeClient, WalletClient} = require('bclient');

const BTCnode = new NodeClient({
  network: 'testnet',
  port: 18332,
  apiKey: 'api-key'
});

const BCHnode = new NodeClient({
  network: 'testnet',
  port: 18032,
  apiKey: 'api-key'
});

const BTCwalletClient = new WalletClient({
  network: 'testnet',
  port: 18334,
  apiKey: 'api-key'
});

const BCHwalletClient = new WalletClient({
  network: 'testnet',
  port: 18034,
  apiKey: 'api-key'
});

const BTCwallet = BTCwalletClient.wallet('primary');
const BCHwallet = BCHwalletClient.wallet('primary');

if (process.argv.indexOf('status') !== -1){
  (async () => {
    BTCinfo = await BTCnode.getInfo();
    BCHinfo = await BCHnode.getInfo();
    console.log('\nBTC node info:\n', BTCinfo.chain);
    console.log('\nBCH node info:\n', BCHinfo.chain);
    console.log('\nBTC wallet info:\n', await BTCwallet.createAddress('default'));
    console.log('\nBCH wallet info:\n', await BCHwallet.createAddress('default'), '\n');
  })().catch((err) => {
    console.error(err.stack);
  });
}

