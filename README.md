# Cross-chain atomic swaps for bcoin and bcash

This project was written as the basis for an educational guide at
[https://bcoin.io/guides/swaps](https://bcoin.io/guides/swaps).

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

### Launching nodes

This should work with any type of node (Full, Pruned, or SPV). Once configuration above is complete,
start both nodes:
```
bcoin --spv --daemon
bcash --spv --daemon
```

To interact with the nodes in this configuration, remember to pass the port number:
```
# to getinfo from bcash node
bcoin-cli --http-port=18032 --api-key=api-key info
```

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

**This is merely a proof-of-concept and should not be used in production without modifications to the security and pirvacy of the protocol. Pull requests are welcome!**

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
It will also fund the BCH address with the amount Alice has specified.

Meanwhile, Bob also runs `run-swap` with a few differences:

* `--mine` and `--theirs` are his and Alice's private and public info, respectively

* `--have=bcoin --want=bcash --mode=swap`

* `--amount` sets the amount of BTC in satoshis Bob wants to trade.

Bob's app will also create P2SH addresses and watch-only wallets. When Alice's first transaction on
BCH is confirmed, Bob's app will verify the amount against the Coinbase BCH-BTC exchange rate, and then
fund the P2SH address on the BTC chain.

When Bob's BTC transaction is confirmed, Alice's app will sweep it, revealing the HTLC secret.

Bob's app will detect Alice's sweep, extract the HTLC secret, and use it to sweep the funds
on the BCH chain.

Either party can run the exact same `run-swap` command with the additional option `--refund=true`
to cancel the swap. The app will wait until enough network time has passed before broadcasting the
relative timelock refund transaction.

### All run-swap options:

| Parameter | Default | Description
|-|-|-|
| `mine` | (none) | The PRIVATE string returned by `prep-swap`
| `theirs` | (none) | The PUBLIC string sent by counterparty
| `have` | (none) | `bcoin` or `bcash`: the coin you have, to send to counterparty
| `want` | (none) | `bcoin` or `bcash`: the coin you want, to receive from counterparty
| `mode` | (none) | `start`: Creates HTLC secret and sends first transaction<br>`swap`: Sends second transaction and extracts HTLC secret for final swap redemption
| `amount` | (none) | The amount (of coin you have) to send. In `swap` mode exchange rate will be checked before broadcasting transaction
| `passphrase` | (none) | Wallet passphrase for funding HTLCs
| `walletID` | `primary` | Wallet for funding-from and sweeping-to (both chains)
| `walletAcct` | `default` | Wallet account for funding/sweeping to (both chains)
| `swapTime` | 1 hour | Relative locktime (in seconds) to refund second swap tx (Bob in above example)
| `cancelTime` | 1 day | Relative locktime (in seconds) to refund initial swap tx (Alice in above example)
| `fee` | `1000` | Absolute fee in satoshis (not sat/B) for HTLC redemptions on both chains
| `network` | `testnet` | Network for both chains
| `refund` | `false` | Attempts to refund any eligible HTLC already confirmed in a previous run
| `tolerance` | `0.05` | Using Coinbase BCH-BTC ticker, compare received amount on one chain to specified `amount` on other chain


## TODO

- [ ] Enable specification of parameters for different chains (walletID, passphrase)
- [ ] Enable SegWit support for bcoin and hsd
- [ ] Integrate hsd
- [ ] Use smart fee calculation instead of set fee
- [ ] More robust key/contract exchange, including intended swap amounts
- [ ] In `start` mode, check if 1st tx has already been sent in a previous run
- [ ] In both modes, check for counterparty refund before broadcasting anything
- [ ] Refactor out lots of repeated code between modes
- [ ] For refunds, sweep all outputs instead of refunding one at a time
- [ ] Move global variables to an `options` object
- [ ] Classify


