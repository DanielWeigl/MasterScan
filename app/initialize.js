'use strict';


const Handlebars = require('handlebars');
const jQuery = require('jquery');
const $ = jQuery;
window.$ = window.jQuery = jQuery;  // workaround for browserify

const _ = require('lodash');

// Bootstrap
const bootstrap = require('bootstrap');
const styleBs = require('../node_modules/bootstrap/dist/css/bootstrap.css'); //cssify
require('bootstrap');

const toastr = require('toastr');
const styleToastr = require('../node_modules/toastr/build/toastr.css'); //cssify


const bitcore = require('bitcore-lib');
const {
    HDPrivateKey,
    Networks,
    Unit,
    Transaction,
    Block,
    Address
} = bitcore;

const Masterscan = require('./masterscan');

const cfg = {
    network: bitcore.Networks.testnet
    //network : bitcore.Networks.livenet
};

const Insight = require('./insightApi.js');

//const qrcode = require('jsqrcode')();
const qr = require('./html5-qrcode.js');

var scanner = null;
var lastResult = null;
var lastTransaction = null;

var insight = new Insight((cfg.network === Networks.livenet) ? 'insight.bitpay.com' : 'test-insight.bitpay.com');

document.addEventListener('DOMContentLoaded', function () {
    const ui = {
        txRootNode: $('#txRootNode'),
        txReceiverAddress: $('#txReceiverAddress'),
        txTransaction: $('#txTransaction'),
        txFeePerByte: $('#txFeePerByte'),
        btnScan: $('#btnScan'),
        btnUpdateTransaction: $('#btnUpdateTransaction'),
        btnSendTransaction: $('#btnSendTransaction'),
        btnQrCode: $('#btnQrCode'),
        lblRootKeyInfo: $('#lblRootKeyInfo'),
        lblRootKeyInfoError: $('#lblRootKeyInfoError'),
        divAccounts: $('#accounts'),
        divUtxos: $('#utxos'),
        divReader: $('#divReader'),
        divTxTransaction: $('#divTxTransaction'),
        divTxFeePerByte: $('#divTxFeePerByte'),
        modalQrReader: $('#modalQrReader'),
        spTotalFee: $('#spTotalFee'),
        spPercentageFee: $('#spPercentageFee'),
        spSendingAmount: $('#spSendingAmount'),
        spTxSize: $('#spTxSize'),
        aCheckTx: $('#aCheckTx'),
    };

    const tmpl = {
        accounts: Handlebars.compile($("#accounts-template").html()),
        utxos: Handlebars.compile($("#utxos-template").html()),
        addresslist: Handlebars.compile($("#addresslist-template").html()),
    };

    toastr.options.timeOut = 30 * 1000;
    toastr.options.extendedTimeOut = 0;
    toastr.options.closeButton = true;

    Handlebars.registerPartial('addresses', tmpl.addresslist);

    function link(url, tx, css) {
        return new Handlebars.SafeString("<a href='" +
            Handlebars.escapeExpression(url) +
            "' target='_blank' class='" +
            (css || "") +
            "'>" +
            Handlebars.escapeExpression(tx) +
            "</a>"
        );
    };

    Handlebars.registerHelper('txLink', function (txid, text) {
        const ll = link("http://tbtc.blockr.io/tx/info/" + txid, text || txid);
        return ll;
    });

    Handlebars.registerHelper('addrHiddenLink', function (addr, text) {
        const ll = link("http://tbtc.blockr.io/address/info/" + addr, text || addr, "hiddenLink");
        return ll;
    });

    const formatSatoshi = function (sats) {
        return sats / 100000000 + " BTC";
    };

    Handlebars.registerHelper('formatSatoshi', formatSatoshi);

    Handlebars.registerHelper('getTotal', function (utxoSet) {
        return formatSatoshi(utxoSet.totalAmount);
    });

    ui.btnScan.click(function () {
        ui.lblRootKeyInfoError.text('').addClass('hidden');
        ui.lblRootKeyInfo.text('');

        const masterseed = ui.txRootNode.val();
        if (_.isEmpty(masterseed)) {
            ui.lblRootKeyInfoError.text('Error: Enter the masterseed or the xPriv/xPub of the root node').removeClass('hidden');
        } else {
            try {
                scanner = new Masterscan(masterseed, cfg.network, insight);
                ui.lblRootKeyInfo.text(scanner.rootnode);
                scanner.scan(updateAccountList)
                    .then(accounts => {
                        const utxos = accounts.getUtxo();
                        lastResult = accounts;
                        updateAccountList(accounts);
                        updateTransaction(accounts);
                        const spendable = formatSatoshi(accounts.getUtxo().totalAmount);
                        toastr.success("Found " + accounts.numUsedAccounts + " accounts with a total of " + spendable + " spendable", "Synchronization successfull")
                    });
            } catch (e) {
                if (e.name == "bitcore.ErrorMnemonicUnknownWordlist" || e.name =="bitcore.ErrorMnemonicInvalidMnemonic") {
                    ui.lblRootKeyInfoError.text('Error: ' + e.message).removeClass('hidden');
                } else {
                    throw e;
                }
            }
        }
    });

    ui.btnUpdateTransaction.click(()=> {
        if (lastResult) updateTransaction(lastResult);
    });

    ui.btnSendTransaction.click(() => {
        if (lastTransaction) {
            Masterscan.broadcastTx(lastTransaction, insight)
                .then(d => {
                    console.log(d);
                    if (d.err){
                        toastr.error("Broadcast failed: " + d.err, "Unable to send");
                    } else {
                        toastr.success("Transaction broadcast!<br>Transaction id: " + Handlebars.escapeExpression(d.txid), 'Sending...');
                    }
                });
        }
    });

    ui.btnQrCode.click(() => {
        qr(jQuery);
        ui.modalQrReader.modal('show');
        ui.divReader.html5_qrcode(function(data){
                var str = (data.indexOf('bitcoin:') === 0) ? data.substring(8) : data;
                console.log('QR code detected: ' + str);
                ui.txReceiverAddress.val(str);
                ui.divReader.html5_qrcode_stop();
                ui.modalQrReader.modal('hide');
            },
            function(error){
                console.log(error);
            }, function(videoError){
                //the video stream could be opened
                console.log(error);
                toastr.info("Error: " + error, "Unable to open camera");
            });
    });

    ui.modalQrReader.on('hidden.bs.modal', function (e) {
        ui.divReader.html5_qrcode_stop();
    });

    ui.txReceiverAddress.on('input propertychange paste', () => {
       clearTx();
    });

    function clearTx(){
        ui.txTransaction.val("");
        ui.spTotalFee.text("n/a");
        ui.spPercentageFee.text("n/a");
        ui.spSendingAmount.text("n/a");
        ui.spTxSize.text("n/a");
        ui.aCheckTx.attr('href', "https://coinb.in/#verify");
        ui.divTxTransaction.removeClass("has-error")
        ui.divTxFeePerByte.removeClass("has-error")
    }

    function updateAccountList(accounts) {
        const utxos = accounts.getUtxo();

        ui.divAccounts.html(tmpl.accounts(accounts));
        ui.divUtxos.html(tmpl.utxos(utxos));
    }

    function updateTransaction(accounts) {
        const utxos = accounts.getUtxo();
        const keyBag = accounts[0].keyBag;
        const addr = ui.txReceiverAddress.val();
        const fee = ui.txFeePerByte.val();
        // todo validate

        if (!Address.isValid(addr, cfg.network)){
            clearTx();
            ui.divTxTransaction.addClass("has-error");
            return;
        }

        if (_.isNumber(fee)){
            clearTx();
            ui.divTxFeePerByte.addClass("has-error");
            return;
        }

        scanner.prepareTx(utxos, keyBag, addr, fee).then(tx => {
            lastTransaction = tx;
            const rawTx = tx.toString();
            ui.txTransaction.val(rawTx);
            const totalFee = tx.getFee();
            const totalValue = tx.outputAmount;
            ui.spTotalFee.text(formatSatoshi(totalFee));
            ui.spPercentageFee.text(Math.round(totalFee / totalValue * 100) + "%");
            ui.spSendingAmount.text(formatSatoshi(totalValue));
            ui.spTxSize.text(tx.toBuffer().length + " Bytes");
            ui.aCheckTx.attr('href', "https://coinb.in/?verify=" + rawTx);
        })
    }

    Masterscan.fetchFee(2, insight)
        .then(d => {
            if (d.err){
                toastr.info("Unable to fetch current transaction fee level. A default value is used. " + d.err, "Unable to query fee");
                ui.txFeePerByte.val(20);
            } else {
                ui.txFeePerByte.val(d);
            }
        });
});

