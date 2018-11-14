# Cross-chain atomic swaps for bcoin and bcash

This project was written as the basis for an educational guide at
[https://bcoin.io/guides/swaps](https://bcoin.io/guides/swaps).

The guide is far more detailed regarding usage than this README.

It is not private or secure! Use at your own risk.

---

## Install

```
git clone git://github.com/pinheadmz/swap-test.git
cd swap-test
npm install
```

This app has `bcoin` and `bcash` listed as peer dependencies.
It is assumed that the user has them already installed globally:

```
npm install -g bcoin
npm install -g bcash
```

...and that the [NODE_PATH](https://nodejs.org/api/modules.html#modules_loading_from_the_global_folders)
environment variable is set.

## Configuration

Example `.conf` files are provided for all four servers (node/wallet, bcoin/bcash).
These examples could be copied directly to the default data directories like so:

```
cp conf/bcash.conf ~/.bcash/bcash.conf
cp conf/bcash-testnet-wallet.conf ~/.bcash/testnet/wallet.conf
cp conf/bcoin.conf ~/.bcoin/bcoin.conf
cp conf/bcoin-testnet-wallet.conf ~/.bcoin/testnet/wallet.conf
```

The app and tests are hard-coded for `testnet` and specific non-default port numbers so be
sure to configure correctly!

### http ports:
```
bcoin node:   18332 # default for testnet
bcoin wallet: 18334 # default for testnet
bcash node:   18032
bcash wallet: 18034
```

NOTE: At this time, [a small update to bcash](https://github.com/bcoin-org/bcash/pull/92/files)
is pending and these configuration files will not work until it is merged, or manually updated.

## Testing

### Library test

```
node test/lib-test.js
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
node test/net-test.js --lib=<bcoin|bcash> --mode=<swap|refund>
```

This test will connect to your running node (full, pruned or SPV), create an HTLC redeem script
and a watch-only wallet, then provide the user with a P2SH address:

```
Swap P2SH address:
 2MyAcg4euiSKBa6ShmvkJQqhEHQrbwUTC6f
```

Sending any amount of coins to this address should trigger an event repsonse which
sweeps the funds using the specified branch of the HTLC. Note that the `refund` mode
redeems a realtive timelock output (CSV) and the test will **actually wait** 20 minutes before sending
the redeem transaction!

## App

**This is merely a proof-of-concept and should not be used in production without modifications to the security and pirvacy of the protocol**

Alice has Bitcoin Cash and wants Bitcoin. Bob has Bitcoin and wants Bitcoin Cash.

Alice runs `app/prep-swap.js` and sends her PUBLIC info to Bob.

Bob runs `app/prep-swap.js` and sends his PUBLIC info to Alice.

They decide Alice will start.

Alice runs `app/run-swap.js` and passes in several parameters:

* `--mine` her own PRIVATE info from `prep-swap`

* `--theirs` Bob's public info

* `--have=bcash --want=bcoin --mode=start`

* `--amount` the amount of BCH in satoshis Alice wants to trade

This action will create a P2SH address for both chains, and watch-only wallets on both chains.
It will also fund the BTC address with the amount Alice has specified.

Meanwhile, Bob also runs `run-swap` with a few differences:

* `--mine` and `--theirs` are his and Alice's info, respectively

* `--have=bcoin --want=bcash --mode=swap`

* `--amount` in this case sets the amount of BTC in satoshis Bob wants to trade.

Bob's app will also create P2SH addresses and watch-only wallets. When Alice's first transaction on
BCH is confirmed, Bob's app will verify the amount against his maximum and the exchange rate, and then
fund the P2SH address on the BTC chain.

When Bob's BTC transaction is confirmed, Alice's app will sweep it, revealing the HTLC secret.

Bob's app will detect Alice's sweep, extract the HTLC secret, and use it to sweep the funds
on the BCH chain.

Either party can run the exact same `run-swap` command with the additional option `--refund=true`
to cancel the swap. The app will wait until enough network time has passed before broadcasting the
relative timelock refund transaction.








