'use strict';

require('whatwg-fetch');
const bitcore = require('bitcore-lib');
const Transaction = bitcore.Transaction;
const _ = require('lodash');
const INSIGHT_ENDPOINT = 'api';

class Insight {
    constructor(host) {
        this.host = host;
        this.inFlight = 0;
    }

    isAddressUsed(address) {
        const endpoint = `/addr/${address}?noTxList=1`;
        return this.unwrapJson(this.queuedFetch(this.sanitizeURL(endpoint)));
    }

    getUTXOs(addresses) {
        const endpoint = '/addrs/utxo';
        return this.unwrapJson(this.queuedFetch(this.sanitizeURL(endpoint), {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                addrs: addresses.join(','),
            }),
        }));
    }


    sendTransaction(tx) {
        const endpoint = `/tx/send`;
        return this.unwrapJson(this.queuedFetch(this.sanitizeURL(endpoint), {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                rawtx: tx.serialize(),
            }),
        }));
    }

    getFeeEstimate(nblocks) {
        const endpoint = `/utils/estimatefee?nbBlocks=${nblocks}`;
        return this.unwrapJson(this.queuedFetch(this.sanitizeURL(endpoint)));
    }

    unwrapJson(response) {
        return response.then(d => {
            if (d.ok) {
                return d.json();
            } else {
                // we got a non-json error response
                return d.text().then(txt => {
                    throw new Error(txt);
                });
            }
        });
    }

    // some browser dont limit the amount of parallel requests (firefox) and the remote service returns
    // overload errors. This function only allows to have a certain amount of pending ajax request running.
    queuedFetch(url, config) {
        var that = this;
        var p = new Promise((okay, fail) => {
            function doIt() {
                that.inFlight++;
                that.fetchRetry(url, 1000, 10, config)
                    .then((d) => {
                        that.inFlight--;
                        okay(d);
                    })
                    .catch((e) => {
                        that.inFlight--;
                        fail(e);
                    });
            }

            function checkIt() {
                if (that.inFlight > 3) {
                    window.setTimeout(checkIt, 250);
                } else {
                    doIt();
                }
            }

            checkIt();
        });
        return p;
    }

    // base on: https://stackoverflow.com/questions/46175660/fetch-api-retry-if-http-request-fails
    // retry the fetch a few times with increasing delay to handle ratelimiting erros better
    fetchRetry(url, delay, limit, fetchOptions = {}) {
        return new Promise((resolve, reject) => {
            function success(response) {
                resolve(response);
            }

            function failure(error) {
                limit--;
                if (limit) {
                    setTimeout(fetchUrl, delay)
                    delay = delay * 1.5;
                }
                else {
                    // this time it failed for real
                    reject(error);
                }
            }

            function finalHandler(finalError) {
                throw finalError;
            }

            function fetchUrl() {
                return fetch(url, fetchOptions)
                    .then(success)
                    .catch(failure)
                    .catch(finalHandler);
            }

            fetchUrl();
        });
    }

    sanitizeURL(url) {
        url = `${this.host}/${INSIGHT_ENDPOINT}` + url;
        let ret = url.replace(/\s/g, '');
        if (!ret.startsWith('http://') && !ret.startsWith('https://')) {
            ret = `https://${ret}`;
        }
        return ret;
    }
}

module.exports = Insight;
