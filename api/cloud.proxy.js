/*
Copyright (c) 2014, Intel Corporation

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright notice,
      this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright notice,
      this list of conditions and the following disclaimer in the documentation
      and/or other materials provided with the distribution.
    * Neither the name of Intel Corporation nor the names of its contributors
      may be used to endorse or promote products derived from this software
      without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

"use strict";
var msg = require('../lib/cloud-message'),
    common = require('../lib/common'),
    path = require("path"),
    proxyConnector = require('../lib/proxies').getProxyConnector();

function IoTKitCloud(conf, logger, deviceId, customProxy){
    var me = this;
    me.logger = logger;
    me.filename = conf.token_file || "token.json";
    me.fullFilename = path.join(__dirname, '../certs/' +  me.filename);
    me.secret = common.readFileToJson(me.fullFilename);
    me.proxy = customProxy || proxyConnector;
    me.max_retries = conf.activation_retries || 10;
    me.deviceId = deviceId;
    me.gatewayId = conf.gateway_id || deviceId;
    me.activationCode = conf.activation_code;
    me.logger.debug('Cloud Proxy Created with Cloud Handler ', me.proxy.type);
}
IoTKitCloud.prototype.isActivated = function () {
    var me = this;
    var token = me.secret.deviceToken;
    var account = me.secret.accountId;
    if (token && token.length > 600) {
        if (account && account.length > 30) {
            return true;
        }
    }
    return false;
};
/**
 * Handler to wait the token from server,
 * the token is use to auth metrics send by the device
 * @param data
 */
IoTKitCloud.prototype.activationComplete = function (callback) {
    var me = this,
        toCall = callback;

    var handler = function (data) {
        me.logger.info('Activation Data Recv: %s', data);
        if (data && (data.status === 0)) {
            me.secret.deviceToken = data.deviceToken;
            me.secret.accountId = data.accountId;
            me.activationCompleted = true;
            me.logger.info('Saving device token ');
            common.writeToJson(me.fullFilename, me.secret);
        } else {
            me.logger.error('Token Not Recv: %s');
        }
        toCall(data.status);
    };
    return handler;
};
/**
 * It will activate the device, by sending the activation code and receiving the token
 * from server if the toke is at device the activation will not called.
 * @param callback
 */
IoTKitCloud.prototype.activate = function (code, callback) {
    var me = this,
        toCall = callback;
    me.logger.debug('Starting Activate Process function');
    if ("function" === typeof code) {
        toCall = code;
        code = null;
    }
    function complete (status) {
        /**
        * It were sent ever activation the update Metadata,
         * since every start/stop the HW could change.
        */
       if (status === 0) {
           me.update();
       }
       toCall(status);
    }
    if (!me.isActivated()) {
        var ActMessage = {
                    deviceId: me.deviceId,
                    code: code || me.activationCode
                };
        me.logger.debug('Device is NOT active...trying activation');
        me.proxy.activation(ActMessage, me.activationComplete(complete));
    } else {
        complete(0);
    }
};

IoTKitCloud.prototype.update = function(callback) {
    var me = this;
    var doc = new msg.Metadata(me.gatewayId);
    doc.deviceToken = me.secret.deviceToken;
    doc.deviceId = me.deviceId;
    me.proxy.attributes(doc, function () {
        me.logger.debug("attributes has returned from ", me.proxy.type);
       if (callback) {
           callback();
       }
    });
};
IoTKitCloud.prototype.disconnect = function () {
  var me = this;
  me.proxy.disconnect();
};

IoTKitCloud.prototype.dataSubmit = function (metric) {
    var me = this;
    metric.accountId = me.secret.accountId;
    metric.did = me.deviceId;
    me.logger.debug("Metric doc: %j", metric, {});
    me.proxy.data(metric);

};
IoTKitCloud.prototype.regComponent = function(comp) {
    var me = this;
    var doc = JSON.parse(JSON.stringify(comp)); //HardCopy to remove reference bind
    doc.deviceToken = me.secret.deviceToken;
    doc.deviceId =  me.deviceId;
    me.logger.debug("Reg Component doc: %j", doc, {});
    me.proxy.addComponent(doc);
};
IoTKitCloud.prototype.desRegComponent = function(comp) {
    var me = this;
  /*  var doc =  JSON.parse(JSON.stringify(comp)); //HardCopy to remove reference bind
    doc.deviceToken = me.secret.deviceToken;
    me.logger.debug("DesReg Component doc: %j", doc, {});
    me.client.publish(buildPath(me.topics.device_component_del, me.deviceId),
                                doc,
                                me.pubArgs);*/
};

IoTKitCloud.prototype.test = function(callback) {
    var me = this;
    me.logger.info("Trying to Connect IotKit Analytics");
    me.proxy.health(me.deviceId, function (result) {
          me.logger.debug("Response ", result)
          callback(result);
    });
};

exports.init = function(conf, logger, deviceId) {
    return new IoTKitCloud(conf, logger, deviceId);
};