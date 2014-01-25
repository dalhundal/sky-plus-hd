/* Requires */

var ssdp = require('node-ssdp');
var q = require('q');
var _ = require('underscore');
var request = require('request');
var util = require('util');
var xml2js = require('xml2js');
_.str = require('underscore.string');

/* ===== */

var SkyPlusHD_Settings = {
   findTimeout: 5000,
   SSDP: {
      SkyServe    : "urn:schemas-nds-com:device:SkyServe:2",
      SkyBook     : "urn:schemas-nds-com:service:SkyBook:2",
      SkyBrowse   : "urn:schemas-nds-com:service:SkyBrowse:2",
      SkyControl  : "urn:schemas-nds-com:device:SkyControl:2",
      SkyPlay     : "urn:schemas-nds-com:service:SkyPlay:2",
      SkyCM       : "urn:schemas-nds-com:service:SkyCM:2",
      SkyRC       : "urn:schemas-nds-com:service:SkyRC:2"
   }
};

var SkyBoxRequest = request.defaults({
   encoding: 'utf8',
   headers: {
      'User-Agent': 'SKY_skyplus'
   },
   timeout: 5000
});

var XmlParser = xml2js.parseString;

/* ===== */


var SkyPlusHD = function() {

   var self = this;

   this.find = function SkyPlusHD_find() {
      var deferred = q.defer();
      //
      var ssdpClient = new ssdp();
      ssdpClient.on('response', function SkyPlusHD_find_ssdpClient_onResponse (msg, rinfo) {
         clearTimeout(timeoutTimer);
         var parsedMsg = parseMsg(msg);
         var skyBox = new SkyPlusHDBox({
            ip: rinfo.address,
            port: rinfo.port,
            xml: parsedMsg.LOCATION
         });
         deferred.resolve(skyBox);
      });
      ssdpClient.search(SkyPlusHD_Settings.SSDP.SkyRC);
      //
      var timeoutTimer = setTimeout(function() {
         deferred.reject(new Error('Timeout'));
      },SkyPlusHD_Settings.findTimeout);
      //
      return deferred.promise;
   };

   function parseMsg(msg) {
      var data = {};
      _.each(_.str.lines(msg), function(line) {
         var matches = line.match(/^(.*?):(.*)\s?$/);
         if (matches) data[matches[1]] = _.str.trim(matches[2]);
      });
      return data;
   }

};

/* ===== */

var SkyPlusHDBox = function (options) {
   var self = this;
   //
   options = this.options = _.extend({
      ip: null,
      port: null,
      xml: null,
      ownIp: "192.168.1.152",
      ownPort: "5095"
   },options);
   //
   this.description = util.format("SkyPlusHD box at [%s:%d]",options.ip,options.port);
   this.details = {
      modelDescription: null,
      modelName: null,
      modelNumber: null,
      friendlyName: null,
      manufacturer: null
   };
   this.services = {};
   //
   this.fetchDescriptionXml = function (url) {
      var deferred = q.defer();
      SkyBoxRequest(url,function(err,msg,body) {
         if (err) {
            deferred.reject(new Error(err));
         } else {
            XmlParser(body,function(err,result) {
               if (err) {
                  deferred.reject(new Error(err));
               } else {
                  self.details = {
                     modelDescription: result.root.device[0].modelDescription,
                     modelName: result.root.device[0].modelName,
                     modelNumber: result.root.device[0].modelNumber,
                     friendlyName: result.root.device[0].friendlyName,
                     manufacturer: result.root.device[0].manufacturer
                  };
                  //
                  _.each(result.root.device[0].serviceList[0].service,function(serviceNode) {
                     self.services[serviceNode.serviceType[0]] = {
                        serviceType: serviceNode.serviceType[0],
                        serviceId: serviceNode.serviceId[0],
                        SCPDURL: serviceNode.SCPDURL[0],
                        controlURL: serviceNode.controlURL[0],
                        eventSubURL: serviceNode.eventSubURL[0]
                     };
                  });
                  //
                  deferred.resolve();
               };
            });
         }
      });
      return deferred.promise;
   };
   //
   this.fetchDescriptionXml(options.xml)
      .then(function() {
         self.subscribe();
      });
   /* === */
   this.subscribe = function SkyPlusHDBox_subscribe() {
      var deferred = q.defer();
      var subscriptionId = util.format("sky/monitor/NOTIFICATION/%d",new Date().valueOf());
      //
      var requestOptions = {
         url: util.format("http://%s:%d%s",options.ip,49153,self.services[SkyPlusHD_Settings.SSDP.SkyPlay].eventSubURL),
         method: 'SUBSCRIBE',
         headers: {
            callback: util.format("<http://%s:%d/%s>",options.ownIp,options.ownPort,subscriptionId),
            nt: 'upnp:event'
         }
      };
      //
      SkyBoxRequest(requestOptions,function(err,msg,body) {
         if (err) deferred.reject(err)
         else if (msg.statusCode != 200) deferred.reject(new Error: 'Failed to subscribe to events, http status '+msg.statusCode)
         else deferred.resolve(subscriptionId);
      });
      return deferred.promise;
   };
};

/* ===== */

var sky = new SkyPlusHD();
sky.find()
   .fail(function(msg) {
      console.log('Error',msg);
   })
   .then(function(skyBox) {
      console.log("FOUND",skyBox.description);
      console.log(skyBox.options);
   })
   .fin(function() {
      //process.exit();
   });
