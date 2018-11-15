/**
 * xrate.js - get currency exchange rate from Coinbase API
 * Copyright (c) 2018, The bcoin Developers (MIT License)
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const https = require('https');

/**
 * xrate
 * Exchange Rate object for bcoin atomic swaps
 */

class Xrate {
  constructor(options) {
    this.have = options.have;
    this.want = options.want;
    this.receivedAmount = options.receivedAmount;
  }

  /**
   * Use the Coinbase BCH-BTC API to get an "expected" amount of the
   * "want" coin given an amount of the "have" coin.
   */

  getSwapAmt() {
    const options = {
      hostname: 'api.pro.coinbase.com',
      path: '/products/BCH-BTC/ticker',
      headers: {'User-Agent': 'Request-Promise'}
    };

    // Need this to be async so the app doesn't think price is `undefined`
    return new Promise ((resolve, reject) => {
      https.get(options, (resp) => {
        // https.get API streams data
        let data = '';
        resp.on('data', (chunk) => {
          data += chunk;
        });

        // we're done now
        resp.on('end', () => {
          const rate = JSON.parse(data).price;

          // calculate the exchange rate in the right direction
          if (this.have === 'bcoin' && this.want === 'bcash')
            resolve(parseInt(rate * this.receivedAmount));
          else if (this.have === 'bcash' && this.want === 'bcoin')
            resolve(parseInt(this.receivedAmount / rate));
          else
            reject('Bad have/want');
        });
      }).on('error', (err) => {
        reject('Error: ' + err.message);
      });
    });
  }
}

/**
 * Expose
 */

module.exports = Xrate;
