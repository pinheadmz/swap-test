/*!
 * swap.js - cross-chain atomic swap manager for the bcoin family
 * Copyright (c) 2018, The bcoin Developers (MIT License)
 * https://github.com/bcoin-org/bcoin
 */

'use strict'

const {
  Outpoint,
  Coin,
  MTX,
  TX,
  Address,
  ScriptNum,
  hd,
  KeyRing,
  Script,
  Stack
} = require('bcoin');
const bcrypto = require('bcrypto');
const {NodeClient, WalletClient} = require('bclient');

/**
 * Swap
 */

class Swap {

  constructor(){
    this.BTCnode = new NodeClient({
      network: 'testnet',
      port: 18332,
      apiKey: 'api-key'
    });

    this.BCHnode = new NodeClient({
      network: 'testnet',
      port: 18032,
      apiKey: 'api-key'
    });

    this.BTCwalletClient = new WalletClient({
      network: 'testnet',
      port: 18334,
      apiKey: 'api-key'
    });

    this.BCHwalletClient = new WalletClient({
      network: 'testnet',
      port: 18034,
      apiKey: 'api-key'
    });

    this.BTCwallet = this.BTCwalletClient.wallet('primary');
    this.BCHwallet = this.BCHwalletClient.wallet('primary');
  }

  async nodeStatus() {
    const BTCinfo = await this.BTCnode.getInfo();
    const BCHinfo = await this.BCHnode.getInfo();

    return {
      'BTCnodeStatus': BTCinfo.chain,
      'BCHnodeStatus': BCHinfo.chain
    }
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
    const master = hd.generate();
    const key = master.derivePath('m/44/0/0/0/0');
    const keyring = KeyRing.fromPrivate(key.privateKey);
    const publickey = keyring.publicKey;

    return {
      'publickey': publickey,
      'privatekey': key.privateKey
    }
  }

  getRedeemScript(hash, refundPubkey, swapPubkey, locktime){
    const redeem = new Script();

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
    return Address.fromScripthash(redeemScript.hash160());
  }

  getRefundInputScript(redeemScript){
    const inputRefund = new Script();

    inputRefund.pushInt(0); // signature placeholder
    inputRefund.pushInt(0);
    inputRefund.pushData(redeem.toRaw());
    inputRefund.compile();

    return inputRefund;
  }

  getSwapInputScript(redeemScript, secret){
    const inputSwap = new Script();

    inputSwap.pushInt(0); // signature placeholder
    inputSwap.pushData(secret);
    inputSwap.pushInt(1);
    inputSwap.pushData(redeem.toRaw());
    inputSwap.compile();

    return inputSwap;
  }

  signInput(mtx, index, redeemScript, value, privateKey, sigHashType, version) {
    return mtx.signature(
      index,
      redeemScript,
      value,
      privateKey,
      sigHashType,
      version
    );
  }

  signInputScript(inputScript, sig){
    inputScript.setData(0, sigRefund);
    inputScript.compile();

    return inputScript;
  }

  getRefundTX(address, coin, fee, redeemScript, inputRefund, privateKey, locktime){
    const refundTX = new MTX();

    refundTX.addOutput({
      address: address,
      value: coin.value - fee;
    })
    refundTX.addCoin(coin);
    refundTX.inputs[0].script = inputRefund;
    refundTX.setLocktime(parseInt(locktime));

    const sig = signInput(
      refundTX,
      0,
      redeemScript,
      coin.value,
      privateKey,
      null,
      0
    );

    inputRefund.setData(0, sig);
    inputRefund.compile();

    const tx = refundTX.toTX();
    return tx;
  }

}


/*
 * Expose
 */

module.exports = Swap;
