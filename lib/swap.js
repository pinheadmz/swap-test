/**
 * swap.js - cross-chain atomic swap manager for the bcoin family.
 * Copyright (c) 2018, The bcoin Developers (MIT License)
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const bcrypto = require('bcrypto');

/**
 * Swap
 */

class Swap {
  constructor(lib, network) {
    // Load library and set network
    this.libName = lib;
    this.lib = require(lib);
    this.lib.Network.set(network);

    // Import modules from library
    this.Outpoint = this.lib.Outpoint;
    this.Coin = this.lib.Coin;
    this.MTX = this.lib.MTX;
    this.TX = this.lib.TX;
    this.Address = this.lib.Address;
    this.hd = this.lib.hd;
    this.KeyRing = this.lib.KeyRing;
    this.Script = this.lib.Script;
    this.Stack = this.lib.Stack;
    this.consensus = this.lib.consensus;
    this.util = this.lib.util;
    this.ChainEntry = this.lib.ChainEntry;

    // Set verification flags like CSV, FORKID, and SegWit
    this.flags = this.Script.flags.STANDARD_VERIFY_FLAGS;
    this.CSV_seconds = true;
  }

  /**
   * Generate a random secret and derive its hash
   * or pass a pre-generated secret to just get the hash
   */

  getSecret(secret) {
    if (!secret)
      secret = bcrypto.random.randomBytes(32);
    else
      secret = ensureBuffer(secret);

    const hash = bcrypto.SHA256.digest(secret);

    return {
      'secret': secret,
      'hash': hash
    };
  }

  /**
   * Generate a private / public key pair
   * or pass a pre-generated private key to just get the public key
   */

  getKeyPair(privateKey) {
    if (!privateKey) {
      const master = this.hd.generate();
      const key = master.derivePath('m/44/0/0/0/0');
      privateKey = key.privateKey;
    } else {
      privateKey = ensureBuffer(privateKey);
    }
    const keyring = this.KeyRing.fromPrivate(privateKey);
    const publicKey = keyring.publicKey;

    return {
      'publicKey': publicKey,
      'privateKey': privateKey,
      'address': keyring.getAddress()
    };
  }

  /**
   * Generate HTLC redeem script
   */

  getRedeemScript(hash, refundPubkey, swapPubkey, locktime) {
    const redeem = new this.Script();
    locktime = this.CSVencode(locktime, this.CSV_seconds);

    hash = ensureBuffer(hash);
    refundPubkey = ensureBuffer(refundPubkey);
    swapPubkey = ensureBuffer(swapPubkey);

    redeem.pushSym('OP_IF');
    redeem.pushSym('OP_SHA256');
    redeem.pushData(hash);
    redeem.pushSym('OP_EQUALVERIFY');
    redeem.pushData(swapPubkey);
    redeem.pushSym('OP_CHECKSIG');
    redeem.pushSym('OP_ELSE');
    redeem.pushInt(locktime);
    redeem.pushSym('OP_CHECKSEQUENCEVERIFY');
    redeem.pushSym('OP_DROP');
    redeem.pushData(refundPubkey);
    redeem.pushSym('OP_CHECKSIG');
    redeem.pushSym('OP_ENDIF');
    redeem.compile();

    return redeem;
  }

  /**
   * Wrap redeem script in P2SH address (legacy)
   */

  getAddressFromRedeemScript(redeemScript) {
    return this.Address.fromScripthash(redeemScript.hash160());
  }

  /**
   * Generate input script for refund
   * Spends from HTLC redeem script
   */

  getRefundInputScript(redeemScript) {
    const inputRefund = new this.Script();

    inputRefund.pushInt(0); // signature placeholder
    inputRefund.pushInt(0);
    inputRefund.pushData(redeemScript.toRaw());
    inputRefund.compile();

    return inputRefund;
  }

  /**
   * Generate input script for counterparty swap
   * Spends from HTLC redeem script
   */

  getSwapInputScript(redeemScript, secret) {
    const inputSwap = new this.Script();

    secret = ensureBuffer(secret);

    inputSwap.pushInt(0); // signature placeholder
    inputSwap.pushData(secret);
    inputSwap.pushInt(1);
    inputSwap.pushData(redeemScript.toRaw());
    inputSwap.compile();

    return inputSwap;
  }

  /**
   * Sign mutable transaction
   */

  signInput(
    mtx,
    index,
    redeemScript,
    value,
    privateKey,
    sigHashType,
    version_or_flags
  ) {
    privateKey = ensureBuffer(privateKey);

    return mtx.signature(
      index,
      redeemScript,
      value,
      privateKey,
      sigHashType,
      version_or_flags
    );
  }

  /**
   * (local testing only) Create a "coinbase" UTXO to spend from
   */

  getFundingTX(address, value) {
    const cb = new this.MTX();
    cb.addInput({
      prevout: new this.Outpoint(),
      script: new this.Script(),
      sequence: 0xffffffff
    });
    cb.addOutput({
      address: address,
      value: value
    });

    return cb;
  }

  /**
   * Generate complete transaction to spend HTLC
   * Works for both swap and refund
   */

  getRedeemTX(
    address,
    fee,
    fundingTX,
    fundingTXoutput,
    redeemScript,
    inputScript,
    locktime,
    privateKey
  ) {
    // Init and check input
    const redeemTX = new this.MTX();
    privateKey = ensureBuffer(privateKey);

    // Add coin (input UTXO to spend) from HTLC transaction output
    const coin = this.Coin.fromTX(fundingTX, fundingTXoutput, -1);
    redeemTX.addCoin(coin);

    // Add output to mtx and subtract fee
    if (coin.value - fee < 0)
      throw new Error('Fee is greater than outout value');
    redeemTX.addOutput({
      address: address,
      value: coin.value - fee
    });

    // Insert input script (swap or refund) to satisfy HTLC conditon
    redeemTX.inputs[0].script = inputScript;

    // Refunds also need to set relative locktime
    if (locktime)
      redeemTX.setSequence(0, locktime, this.CSV_seconds);
    else
      redeemTX.inputs[0].sequence = 0xffffffff;

    // Set SIGHASH flags, legacy address type, FORKID (different between chains)
    let version_or_flags = 0;
    let type = null;
    if (this.libName === 'bcash') {
      version_or_flags = this.flags;
      type = this.Script.hashType.SIGHASH_FORKID | this.Script.hashType.ALL;
    }

    // Sign transaction and insert sig over placeholder
    const sig = this.signInput(
      redeemTX,
      0,
      redeemScript,
      coin.value,
      privateKey,
      type,
      version_or_flags
    );
    inputScript.setData(0, sig);

    // Finish and return
    inputScript.compile();
    return redeemTX;
  }

  /**
   * (for local testing) Check final transactions against protocol
   */

  verifyMTX(mtx) {
    return mtx.verify(this.flags);
  }

  verifyTX(tx, view) {
    return tx.verify(view);
  }

  /**
   * Utility: Search transaction for HTLC redemption and extract hashed secret
   */

  extractSecret(tx, address) {
    if (typeof address !== 'string')
      address = address.toString();

    for (const input of tx.inputs) {
      const inputJSON = input.getJSON();
      const inAddr = inputJSON.address;
      if (inAddr === address)
        return input.script.code[1].data;
    }
    return false;
  }

  /**
   * Utility: Search transaction for address and get output index and value
   */

  extractOutput(tx, address) {
    if (typeof address !== 'string')
      address = address.toString();

    for (let i = 0; i < tx.outputs.length; i++) {
      const outputJSON = tx.outputs[i].getJSON();
      const outAddr = outputJSON.address;
      if (outAddr === address) {
        return {
          index: i,
          amount: outputJSON.value
        };
      }
    }
    return false;
  }

  /**
   * Whereas CLTV takes a regular number (blocks/seconds) as its argument,
   * CSV has a special encoding format for both the script and the tx input
   * This function is modified from bcoin/lib/primitives/mtx.js setSequence()
   */

  CSVencode(locktime, seconds) {
    let locktimeUint32 = locktime >>> 0;
    if(locktimeUint32 !== locktime)
      throw new Error('Locktime must be a uint32.');

    if (seconds) {
      locktimeUint32 >>>= this.consensus.SEQUENCE_GRANULARITY;
      locktimeUint32 &= this.consensus.SEQUENCE_MASK;
      locktimeUint32 |= this.consensus.SEQUENCE_TYPE_FLAG;
    } else {
      locktimeUint32 &= this.consensus.SEQUENCE_MASK;
    }

    return locktimeUint32;
  }

  /**
   * bcoin Wallets can only be <=40 characters long
   */

  nameWallet(address) {
    if (address.length <= 40)
      return address;
    else
      return address.substr(address.length-40);
  }
}

/**
 * Test and App functions might have different types for the same data
 * Ensure that data are always buffers
 */

function ensureBuffer(string) {
  if (Buffer.isBuffer(string))
    return string;
  else
    return new Buffer(string, 'hex');
}

/**
 * Expose
 */

module.exports = Swap;
