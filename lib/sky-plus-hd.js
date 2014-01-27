/* Requires */

var ssdp = require('node-ssdp');
var q = require('q');
var _ = require('underscore');
var request = require('request');
var util = require('util');
var xml2js = require('xml2js');
var http = require('http');
var events = require('events');
var ip = require('ip');
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
      q.all([
         discoverService(SkyPlusHD_Settings.SSDP.SkyRC),
         discoverService(SkyPlusHD_Settings.SSDP.SkyBrowse)
      ]).then(function(vals) {
         var skyRC = vals[0], skyBrowse = vals[1];
         var skyBox = new SkyPlusHDBox({
            ip: skyRC.rinfo.address,
            port: skyRC.rinfo.port,
            xml: [skyRC.msg.LOCATION, skyBrowse.msg.LOCATION]
         });
         skyBox.on('ready',function() {
            deferred.resolve(skyBox);
         });
      }).fail(function(err) {
         deferred.reject(err);
      });
      //
      return deferred.promise;
   };

   function discoverService(serviceUrn) {
      var deferred = q.defer();
      var ssdpClient = new ssdp();
      ssdpClient.on('response',function (msg, rinfo) {
         clearTimeout(timeoutTimer);
         var parsedMsg = parseMsg(msg);
         deferred.resolve({
            msg: parsedMsg,
            rinfo: rinfo
         });
      });
      ssdpClient.search(serviceUrn);
      var timeoutTimer = setTimeout(function() {
         deferred.reject(new Error('Timeout searching for service '+serviceUrn));
      },SkyPlusHD_Settings.findTimeout);
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
      ownIp: ip.address(),
      ownPort: 65432
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
   /* === */
   this.subscribe = function SkyPlusHDBox_subscribe() {
      var deferred = q.defer();
      var subscriptionId = util.format("/sky-plus-hd/notification/%d",new Date().valueOf());
      //
      var requestOptions = {
         url: util.format("http://%s:%d%s",options.ip,49153,self.services[SkyPlusHD_Settings.SSDP.SkyPlay].eventSubURL),
         method: 'SUBSCRIBE',
         headers: {
            callback: util.format("<http://%s:%d%s>",options.ownIp,options.ownPort,subscriptionId),
            nt: 'upnp:event'
         }
      };
      //
      SkyBoxRequest(requestOptions,function(err,msg,body) {
         if (err) deferred.reject(err)
         else if (msg.statusCode != 200) deferred.reject(new Error('Failed to subscribe to events, http status '+msg.statusCode))
         else deferred.resolve({
            sid: msg.headers.sid,
            subscriptionId: subscriptionId
         });
      });
      return deferred.promise;
   };
   /* ==== */
   this.listenForNotifications = function SkyPlusHDBox_listenForNotifications(subscriptionId) {
      http.createServer(function(req,res) {
         if (req.url != subscriptionId) {
            res.writeHead(404,{'Content-Type':'text/plain'});
            res.end();
            return;
         };
         var chunks = "";
         req.on('data', function(chunk) { chunks+=chunk; });
         req.on('end', function() {
            XmlParser(chunks,function(err, result) {
               if (err) return;
               XmlParser(result['e:propertyset']['e:property'][0].LastChange[0],function(err, results) {
                  if (err) return;
                  var ev = {
                     TransportState: results.Event.InstanceID[0].TransportState[0]['$'].val,
                     CurrentTrackURI: results.Event.InstanceID[0].CurrentTrackURI[0]['$'].val,
                     TransportPlaySpeed: results.Event.InstanceID[0].TransportPlaySpeed[0]['$'].val,
                     AVTransportURI: results.Event.InstanceID[0].AVTransportURI[0]['$'].val,
                     TransportStatus: results.Event.InstanceID[0].TransportStatus[0]['$'].val,
                  }
                  console.log(ev);
               });
            });
         });
         res.writeHead(200,{'Content-Type':'text/plain'});
         res.end('OK');
      }).listen(options.ownPort);
   };
   //
   q.all(_.map(options.xml,function(xmlUrl) {
      return self.fetchDescriptionXml(xmlUrl);
   })).then(function() {
      self.subscribe()
         .then(function(response) {
            self.listenForNotifications(response.subscriptionId);
            self.emit('ready');
         });
   });
};
util.inherits(SkyPlusHDBox,events.EventEmitter);

var sky = new SkyPlusHD();
sky.find()
   .fail(function(msg) {
      console.log('Error',msg);
   })
   .then(function(skyBox) {
      console.log("FOUND:",skyBox.description);
      console.log(skyBox.services);
   })
   .fin(function() {
      //process.exit();
   });

