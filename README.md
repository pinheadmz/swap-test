# Cross-chain atomic swaps for bcoin and bcash

This project was written as the basis for an educational guide at
[https://bcoin.io/guides/swaps](https://bcoin.io/guides/swaps).

The guide is far more detailed regarding usage than this README.

It is not private or secure! Use at your own risk.

---

## Install

```
$ git clone git://github.com/pinheadmz/swap-test.git
$ cd swap-test
$ npm install
```

This app has `bcoin` and `bcash` listed as peer dependencies.
It is assumed that the user has them already installed globally:

```
$ npm install -g bcoin
$ npm install -g bcash
```

...and that the [NODE_PATH](https://nodejs.org/api/modules.html#modules_loading_from_the_global_folders)
environment variable is set.

## Configuration

Example `.conf` files are provided for all four servers (node/wallet, bcoin/bcash).
These examples could be copied directly to the default data directories like so:

```
$ cp conf/bcash.conf ~/.bcash/bcash.conf
$ cp conf/bcash-testnet-wallet.conf ~/.bcash/testnet/wallet.conf
$ cp conf/bcoin.conf ~/.bcash/bcoin.conf
$ cp conf/bcoin-testnet-wallet.conf ~/.bcoin/testnet/wallet.conf
```

The app and tests are hard-coded with specific port numbers so be sure to configure correctly!

## Testing

### Library test

```
$ node test/lib-test.js
```

Tests all the functions in the library at `lib/swaps.js` against both bcoin and bcash.
It creates keys, addresses, and both HTLC-redeeming transactions and tests that they verify.
It's important that the tests return true for all libraries being tested:

```
REFUND VERIFY:
 true

SWAP VERIFY:
 true

Secret match:
 true
 ```

### Live network test

bcoin or bcash must be running and already synced to the network.


```
$ node test/net-test.js --lib=<bcoin|bcash> --mode=<swap|refund>
```

This test will connect to your running node (full, pruned or SPV), create a HTLC redeem script
and a watch-only wallet, then provide the user with a P2SH address:

```
Swap P2SH address:
 2MyAcg4euiSKBa6ShmvkJQqhEHQrbwUTC6f
```

Sending any amount of coins to this address should trigger an event repsonse which
sweeps the funds using the specified branch of the HTLC. Note that the `refund` mode
redeems a realtive timelock output (CSV) and it won't work unless the timeout in
`brq/lib/request.js` is HUUUUGE! The script will actually wait for twenty minutes before
attempting to redeem the output.

## App

Ah, here's the fun part :-)




