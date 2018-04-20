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
const Address = bitcore.Address;
const Transaction = bitcore.Transaction;
const bitcoin = require('bitcoinjs-lib');

const Masterscan = require('./masterscan');

const cfg = {
    network: bitcoin.networks.testnet,
    //network : bitcoin.networks.bitcoin,
    version: '0.3',
};

const Insight = require('./insightApi.js');

//const qrcode = require('jsqrcode')();
const qr = require('./html5-qrcode.js');

const blockexplorers={
    testnet:{
        txLink:"http://tbtc.blockr.io/tx/info/",
        addrLink:"http://tbtc.blockr.io/address/info/"
    },
    prodnet:{
        txLink:"http://btc.blockr.io/tx/info/",
        addrLink:"http://btc.blockr.io/address/info/"
    },
}

var scanner = null;
var lastResult = null;
var lastTransaction = null;

var insight;

document.addEventListener('DOMContentLoaded', function () {
    const ui = {
        body: $('body'),
        txRootNode: $('#txRootNode'),
        txPassphrase: $('#txPassphrase'),
        txReceiverAddress: $('#txReceiverAddress'),
        txTransaction: $('#txTransaction'),
        txFeePerByte: $('#txFeePerByte'),
        btnScan: $('#btnScan'),
        btnUpdateTransaction: $('#btnUpdateTransaction'),
        btnSendTransaction: $('#btnSendTransaction'),
        btnQrCodeReceiver: $('#btnQrCodeReceiver'),
        btnQrCodeSeed: $('#btnQrCodeSeed'),
        lblRootKeyInfo: $('#lblRootKeyInfo'),
        lblRootKeyInfoError: $('#lblRootKeyInfoError'),
        divAccounts: $('#accounts'),
        divUtxos: $('#utxos'),
        divReader: $('#divReader'),
        divTxTransaction: $('#divTxTransaction'),
        divTxFeePerByte: $('#divTxFeePerByte'),
        divRootNode: $('#divRootNode'),
        modalQrReader: $('#modalQrReader'),
        modalDisclaimer: $('#modalDisclaimer'),
        spTotalFee: $('#spTotalFee'),
        spPercentageFee: $('#spPercentageFee'),
        spSendingAmount: $('#spSendingAmount'),
        spTxSize: $('#spTxSize'),
        spVersion: $('#spVersion'),
        spNetMode: $('#spNetMode'),
        aCheckTx: $('#aCheckTx'),
        aNetSwitcherProdnet: $('#aNetSwitcherProdnet'),
        aNetSwitcherTestnet: $('#aNetSwitcherTestnet'),
        liNetSwitcherProdnet: $('#liNetSwitcherProdnet'),
        liNetSwitcherTestnet: $('#liNetSwitcherTestnet'),
    };

    const tmpl = {
        accounts: Handlebars.compile($("#accounts-template").html()),
        utxos: Handlebars.compile($("#utxos-template").html()),
        addresslist: Handlebars.compile($("#addresslist-template").html()),
        chain: Handlebars.compile($("#chain-template").html()),
    };

    toastr.options.timeOut = 30 * 1000;
    toastr.options.extendedTimeOut = 60 * 1000;
    toastr.options.closeButton = true;

    Handlebars.registerPartial('addresses', tmpl.addresslist);
    Handlebars.registerPartial('chain', tmpl.chain);

    /** Init **/
    const argNet = getUrlParameter('net');
    if (argNet){
        const isProdnet = argNet=='prodnet';
        cfg.network =  isProdnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
    } else {
        cfg.network = bitcoin.networks.testnet;
    }
    if (cfg.network === bitcoin.networks.bitcoin) {
        cfg.blockexplorer = blockexplorers.prodnet;
        ui.liNetSwitcherProdnet.addClass('hidden');
        ui.spNetMode.text("Prodnet");
        insight = new Insight('insight.bitpay.com');
        //insight = new Insight('bch-insight.bitpay.com');
        ui.modalDisclaimer.modal('show');
    } else {
        cfg.blockexplorer = blockexplorers.testnet;
        ui.liNetSwitcherTestnet.addClass('hidden');
        ui.spNetMode.text("Testnet");
        insight = new Insight('test-insight.bitpay.com');
        //insight = new Insight('https://insight-testnet.mycelium.com');
    }

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
        const ll = link(cfg.blockexplorer.txLink + txid, text || _.truncate(txid, {length:16}));
        return ll;
    });

    Handlebars.registerHelper('fmtState', function (state) {
        var cls='', hint='';
        switch (state){
            case 'scan': cls='glyphicon2 glyphicon-refresh glyphicon-spin'; hint='synchronizing'; break;
            case 'sync': cls='glyphicon2 glyphicon-ok'; hint='synchronized'; break;
            case 'err': cls='glyphicon2 glyphicon-alert'; hint='error'; break;
            default: cls='glyphicon2 glyphicon-question-sign'; hint='unknown state ' + state; break;
        }
        return new Handlebars.SafeString(`<span class='${cls}' title='${hint}'></span>`);
    });

    Handlebars.registerHelper('addrHiddenLink', function (addr, text) {
        const ll = link(cfg.blockexplorer.addrLink + addr, text || addr, "hiddenLink");
        return ll;
    });

    const formatSatoshi = function (sats) {
        if (_.isUndefined(sats)){
            return "n/a";
        } else {
            return  sats / 100000000 + " BTC";;
        }
    };

    Handlebars.registerHelper('formatSatoshi', function (sats) {
        var fmt = formatSatoshi(sats);
        if (sats === 0){
            return new Handlebars.SafeString("<span class='zeroVal'>" + fmt + "</span>");
        } else {
            return fmt;
        }
    });

    ui.spVersion.text("(V" + cfg.version + ")");

    ui.btnScan.click(function () {
        ui.lblRootKeyInfoError.text('').addClass('hidden');
        ui.divRootNode.removeClass('has-error');
        ui.lblRootKeyInfo.text('');

        const masterseed = ui.txRootNode.val();
        const passphrase = ui.txPassphrase.val().trim();
        if (_.isEmpty(masterseed)) {
            ui.lblRootKeyInfoError.text('Error: Enter the masterseed or the xPriv/xPub of the root node').removeClass('hidden');
            ui.divRootNode.addClass('has-error');
        } else {
            try {
                scanner = new Masterscan(masterseed, passphrase, cfg.network, insight);
                ui.lblRootKeyInfo.text(scanner.rootnodeInfo);
                scanner.scan(updateAccountList)
                    .then(accounts => {
                        const utxos = accounts.getUtxo();
                        lastResult = accounts;
                        updateAccountList(accounts);
                        updateTransaction(accounts);
                        const spendable = formatSatoshi(utxos.totalAmount);
                        if (accounts.state == 'err') {
                            toastr.warning("Found " + accounts.numUsedAccounts + " accounts with a total of " + spendable + " spendable. There where some errors while checking for funds", "Synchronization finished with errors");
                        }else {
                            toastr.success("Found " + accounts.numUsedAccounts + " accounts with a total of " + spendable + " spendable", "Synchronization successful");
                        }
                    });
            } catch (e) {
                if (e.name == "errMasterseed") {
                    ui.lblRootKeyInfoError.text('Error: ' + e.message).removeClass('hidden');
                    ui.divRootNode.addClass('has-error');
                } else {
                    throw e;
                }
            }
        }
    });

    ui.btnUpdateTransaction.click(()=> {
        //if (lastResult) updateTransaction(lastResult);
        updateTransaction(lastResult);
    });

    ui.btnSendTransaction.click(() => {
        if (lastTransaction) {
            Masterscan.broadcastTx(lastTransaction, insight)
                .then(d => {
                    console.log(d);
                    toastr.success("Transaction broadcast!<br>Transaction id: " + Handlebars.escapeExpression(d.txid), 'Sending...');
                })
                .catch( e => {
                    console.log(e);
                    toastr.error("Broadcast failed: " + e, "Unable to send");
                });
        }
    });

    ui.btnQrCodeReceiver.click(() => {
        scanQr(function(data){
            var str = (data.indexOf('bitcoin:') === 0) ? data.substring(8) : data;
            console.log('QR code detected: ' + str);
            if (validateAddress(str, cfg.network)){
                ui.txReceiverAddress.val(str);
                clearTx();
            } else {
                toastr.warning("Not a valid address: " + data, "Invalid QR code");
            }
        });
    });

    ui.btnQrCodeSeed.click(() => {
        scanQr(function(data){
            ui.txRootNode.val(data);
        });
    });

    function scanQr(callback){
        qr(jQuery);
        ui.modalQrReader.modal('show');
        ui.divReader.html5_qrcode(function(data) {
                callback(data);
                ui.divReader.html5_qrcode_stop();
                ui.modalQrReader.modal('hide');
            },
            function(error){
                console.log(error);
            },
            function(videoError){
                //the video stream could be opened
                console.log(error);
                toastr.info("Error: " + error, "Unable to open camera");
            }
        );
    }

    ui.modalQrReader.on('hidden.bs.modal', function (e) {
        ui.divReader.html5_qrcode_stop();
    });

    ui.txReceiverAddress.on('input propertychange paste', () => {
       clearTx();
    });

    ui.body.on("change", "input.cbAccount", event => {
        var path = $(event.target).attr('data-path');
        var acc = scanner.accounts.getByPath(path);
        if (acc){
            acc.active = $(event.target).is(":checked");
        }

        updateAccountList(scanner.accounts);
        updateTransaction(scanner.accounts);
    });

    ui.body.on("click", ".panel.account", event => {
        // allow the whole account header act as collapse-toggle
        $(event.target).find('.toggler').click();
    })

    ui.body.on('hide.bs.collapse show.bs.collapse', function (e) {
        var acc = scanner.accounts.accs[e.target.id];
        if (acc){
            acc.isShown = (e.type == 'show');
        }
    });

    function validateAddress (address, network) {
        try {
            bitcoin.address.toOutputScript(address, network);
            return true
        } catch (e) {
            return false
        }
    }

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
        const utxos = accounts.getActiveUtxo();
        ui.divAccounts.html(tmpl.accounts(accounts));
        ui.divUtxos.html(tmpl.utxos(utxos));
    }

    function updateTransaction(accounts) {
        const utxos = accounts.getActiveUtxo();
        const keyBag = accounts.keyBag;
        const addr = ui.txReceiverAddress.val();
        const fee = ui.txFeePerByte.val();

        if (!validateAddress(addr, cfg.network)){
            clearTx();
            ui.divTxTransaction.addClass("has-error");
            return;
        }

        if (_.isNumber(fee)){
            clearTx();
            ui.divTxFeePerByte.addClass("has-error");
            return;
        }

        if (utxos.length === 0){
            clearTx();
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
            ui.txFeePerByte.val(d);
        }).catch(e => {
            toastr.info("Unable to fetch current transaction fee level. A default value is used. " + e, "Unable to query fee");
            ui.txFeePerByte.val(50);
        });

    function getUrlParameter(sParam) {
        var sPageURL = decodeURIComponent(window.location.search.substring(1)),
            sURLVariables = sPageURL.split('&'),
            sParameterName,
            i;

        for (i = 0; i < sURLVariables.length; i++) {
            sParameterName = sURLVariables[i].split('=');

            if (sParameterName[0] === sParam) {
                return sParameterName[1] === undefined ? true : sParameterName[1];
            }
        }
    }
});

