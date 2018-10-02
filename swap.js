/*!
* swap.js - cross-chain atomic swap manager for the bcoin family.
* Copyright (c) 2018, The bcoin Developers (MIT License)
* https://github.com/bcoin-org/bcoin
*/

'use strict'

const bcrypto = require('bcrypto');

/**
 * Swap
 */

class Swap {
  constructor(lib){
    this.lib = lib;

    const {
      Outpoint,
      Coin,
      MTX,
      TX,
      Address,
      hd,
      KeyRing,
      Script,
      Stack
    } = require(lib);

    this.Outpoint = Outpoint;
    this.Coin = Coin;
    this.MTX = MTX;
    this.TX = TX;
    this.Address = Address;
    this.hd = hd;
    this.KeyRing = KeyRing;
    this.Script = Script;
    this.Stack = Stack;

    this.flags = this.Script.flags.STANDARD_VERIFY_FLAGS;
  }


  getSecret(enc) {
    const secret = bcrypto.randomBytes(32);
    const hash = bcrypto.sha256.digest(secret);

    if (enc == 'hex'){
      return {
        'secret': secret.toString('hex'),
        'hash': hash.toString('hex')
      }
    } else {
      return {
        'secret': secret,
        'hash': hash
      }
    }
  }

  getKeyPair(){
    const master = this.hd.generate();
    const key = master.derivePath('m/44/0/0/0/0');
    const keyring = this.KeyRing.fromPrivate(key.privateKey);
    const publicKey = keyring.publicKey;

    return {
      'publicKey': publicKey,
      'privateKey': key.privateKey,
      'address': keyring.getAddress()
    }
  }

  getRedeemScript(hash, refundPubkey, swapPubkey, locktime){
    const redeem = new this.Script();

    redeem.pushSym('OP_IF');
    redeem.pushSym('OP_SHA256');
    redeem.pushData(hash);
    redeem.pushSym('OP_EQUALVERIFY');
    redeem.pushData(swapPubkey);
    redeem.pushSym('OP_CHECKSIG');
    redeem.pushSym('OP_ELSE');
    redeem.pushInt(locktime);
    redeem.pushSym('OP_CHECKLOCKTIMEVERIFY');
    redeem.pushSym('OP_DROP');
    redeem.pushData(refundPubkey);
    redeem.pushSym('OP_CHECKSIG');
    redeem.pushSym('OP_ENDIF');
    redeem.compile();

    return redeem;
  }

  getAddressFromRedeemScript(redeemScript){
    return this.Address.fromScripthash(redeemScript.hash160());
  }

  getRefundInputScript(redeemScript){
    const inputRefund = new this.Script();

    inputRefund.pushInt(0); // signature placeholder
    inputRefund.pushInt(0);
    inputRefund.pushData(redeemScript.toRaw());
    inputRefund.compile();

    return inputRefund;
  }

  getSwapInputScript(redeemScript, secret){
    const inputSwap = new this.Script();

    inputSwap.pushInt(0); // signature placeholder
    inputSwap.pushData(secret);
    inputSwap.pushInt(1);
    inputSwap.pushData(redeemScript.toRaw());
    inputSwap.compile();

    return inputSwap;
  }

  signInput(
    mtx,
    index,
    redeemScript,
    value,
    privateKey,
    sigHashType,
    version_or_flags
  ) {
    return mtx.signature(
      index,
      redeemScript,
      value,
      privateKey,
      sigHashType,
      version_or_flags
    );
  }

  signInputScript(inputScript, sig){
    inputScript.setData(0, sigRefund);
    inputScript.compile();

    return inputScript;
  }

  getFundingTX(address, value){
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

  // works for both refund and swap
  getRedeemTX(
    address,
    fee,
    fundingTX,
    fundingTXoutput,
    redeemScript,
    inputScript,
    locktime,
    privateKey
  ){
    const redeemTX = new this.MTX();

    const coin = this.Coin.fromTX(fundingTX, fundingTXoutput, -1);

    redeemTX.addOutput({
      address: address,
      value: coin.value - fee
    })
    redeemTX.addCoin(coin);
    redeemTX.inputs[0].script = inputScript;
    redeemTX.setLocktime(parseInt(locktime));

    let version_or_flags = 0;
    let type = null;
    if (this.lib === 'bcash') {
      version_or_flags = this.flags;
      type = this.Script.hashType.SIGHASH_FORKID | this.Script.hashType.ALL; 
    }

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
    inputScript.compile();

    return redeemTX;
  }

  verifyMTX(mtx){
    return mtx.verify(this.flags)
  }

  verifyTX(tx, view){
    return tx.verify(view);
  }
}


/*
 * Expose
 */

module.exports = Swap;
