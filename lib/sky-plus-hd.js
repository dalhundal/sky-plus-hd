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
var xml = require('xml');
var pd = require('pretty-data').pd;
_.str = require('underscore.string');

/* ===== */

var SkyPlusHD_Settings = {
   findTimeout: 5000,
   renewSubscriptionInterval: 60000,
   Services: {
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

q.longStackSupport = true;

/* ===== */


var SkyPlusHD = function() {

   var self = this;

   this.find = function SkyPlusHD_find() {
      var deferred = q.defer();
      //
      q.all([
         discoverService(SkyPlusHD_Settings.Services.SkyRC),
         discoverService(SkyPlusHD_Settings.Services.SkyBrowse)
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
      }).done();
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
   },options,{port:49153});
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
   this.planner = new SkyPlusHDPlanner(self);
   this.sid = undefined;
   this.listeningSocket = undefined;
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
                  self.description = util.format("%s %s [model: %s] [software: %s] at %s:%d",self.details.manufacturer, self.details.modelName, self.details.modelDescription, self.details.modelNumber, options.ip, options.port);
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
   var subscribe = function SkyPlusHDBox_subscribe() {
      var deferred = q.defer();
      //
      if (!self.sid) listenForNotifications();
      console.log((self.sid) ? 'Renewing subscription '+self.sid : 'Requesting new subscription');
      //
      var requestOptions = {
         url: util.format("http://%s:%d%s",options.ip,self.options.port,self.services[SkyPlusHD_Settings.Services.SkyPlay].eventSubURL),
         method: 'SUBSCRIBE',
         headers: (self.sid) ? { sid: self.sid }: {
            callback: util.format("<http://%s:%d>",options.ownIp,options.ownPort),
            nt: 'upnp:event'
         }
      };
      //
      SkyBoxRequest(requestOptions,function(err,msg,body) {
         if (err) deferred.reject(err)
         else if (msg.statusCode != 200) deferred.reject(new Error('Failed to subscribe, http status '+msg.statusCode))
         else {
            console.log(self.sid ? "Renewed subscription "+msg.headers.sid : "Created new subscription " + msg.headers.sid);
            self.sid = msg.headers.sid,
            deferred.resolve({
               sid: msg.headers.sid,
               expires: new Date().valueOf() + (parseInt(msg.headers.timeout.replace(/[^0-9]/g,''))*1000),
               timeout: msg.headers.timeout
            });
            //
            setTimeout(function() {
               subscribe()
                  .fail(function() {
                     console.log("Failed to renew subscription "+self.sid);
                     self.sid = undefined;
                     subscribe();
                  });
            },SkyPlusHD_Settings.renewSubscriptionInterval);
         };
      });
      return deferred.promise;
   };
   /* ==== */
   var listenForNotifications = function SkyPlusHDBox_listenForNotifications() {
      if (self.listeningSocket)  {
         console.log("Notification listener already exists");
         return;
      } else {
         console.log("Opening notification listener");
      }
      self.listeningSocket = http.createServer(function(req,res) {
         if (self.sid && req.headers.sid != self.sid) {
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
                  self.emit('stateChanged',ev);
               });
            });
         });
         res.writeHead(200,{'Content-Type':'text/plain'});
         res.end('OK');
      }).listen(options.ownPort);
      console.log("Opened notification listener");
   };
   //
   var generateRequestXML = function(service,method,payload) {
      var transformedPayload = [];
      transformedPayload.push({'_attr':{
         'xmlns:u': service
      }});
      _.each(payload,function(val,key) {
         var obj =  {};
         obj[key]=val;
         transformedPayload.push(obj);
      });
      //
      var sBodyContent = {};
      sBodyContent['u:'+method] = transformedPayload;
      //
      var json = [{
         's:Envelope': [
            {'_attr': {
               's:encodingStyle':'http://schemas.xmlsoap.org/soap/encoding/',
               'xmlns:s':'http://schemas.xmlsoap.org/soap/envelope/'
            }},
            {'s:Body': [sBodyContent]}
         ]}
      ];
      return '<?xml version="1.0" encoding="utf-8"?>'+xml(json);
   };
   //
   function cleanupXml(o) {
      var ret;
      if (_.isArray(o)) {
         ret = [];
      } else {
         ret = {};
      };
      _.each(o,function(v,k) {
         if (!_.isObject(v) && !_.isArray(v)) {
            ret[k] = v;
         } else if (_.isArray(v)) {
            if (v.length==1) {
               ret[k] = v[0]
            } else {
               ret[k] = cleanupXml(v);
            };
         } else if (_.isObject(v)) {
            ret[k] = cleanupXml(v);
         };
      });
      return ret;
   };
   //
   this.soapRequest = function(service,method,payload) {
      var deferred = q.defer();
      var xml = generateRequestXML(service,method,payload);
      var httpOptions = {
         url: util.format("http://%s:%d%s",self.options.ip,self.options.port,self.services[service].controlURL),
         method: 'POST',
         headers: {
            'SOAPACTION': '"'+service + '#'+method+'"',
            'Content-Type': 'text/xml; charset="utf-8"',
         },
         body: xml
      };
      SkyBoxRequest(httpOptions,function(err,msg,body) {
         if (err) {
            deferred.reject(err);
         } else {
            XmlParser(body,function(err,result) {
               if (err) {
                  deferred.reject(err);
               } else {
                  var obj = result['s:Envelope']['s:Body'][0]['u:BrowseResponse'][0];
                  var outObj = {};
                  for (var i in obj) {
                     if (i=='$' || i=='Result') continue;
                     outObj[i] = obj[i][0]
                  };
                  if (obj['Result']) {
                     XmlParser(obj['Result'],function(err,result) {
                        outObj.Result = cleanupXml(result);
                        deferred.resolve(outObj);
                     });
                  } else {
                     deferred.resolve(outObj);
                  };
               }
            });
         };
      });
      return deferred.promise;
   };
   //
   q.all(_.map(options.xml,function(xmlUrl) {
      return self.fetchDescriptionXml(xmlUrl);
   })).then(function() {
      subscribe()
         .then(function(response) {
            self.emit('ready');
         });
   }).done();
};
util.inherits(SkyPlusHDBox,events.EventEmitter);

/* ==== */

var SkyPlusHDPlanner = function(box) {

   var self = this;

   this.updateID = undefined;

   function parsePlannerItem(data) {
      var item = {
         resource: data['res']['_'],
         id: data['vx:X_recordingID'],
         size: parseInt(data['res']['$']['size']),
         title: data['dc:title'],
         description: data['dc:description'],
         channel: {
            num: parseInt(data['upnp:channelNr']),
            name: data['upnp:channelName'],
            id: data['upnp:channelID'] ? data['upnp:channelID']['_'] : undefined, // Could be a download
         },
         lastPlaybackPosition: parseInt(data['vx:X_lastPlaybackPosition']),
         isViewed: (data['vx:X_isViewed']=='1'),
         isPlaying: (data['vx:X_isPlaying']=='1'),
         season: (data['vx:X_seasonNumber']!='0') ? parseInt(data['vx:X_seasonNumber']) : undefined,
         episode: (data['upnp:episodeNumber']!='0') ? parseInt(data['upnp:episodeNumber']) : undefined,
         scheduled: {
            start: data['upnp:scheduledStartTime'],
            end: data['upnp:scheduledEndTime'],
            duration: data['upnp:scheduledDuration']
         },
         recorded: {
            start: data['upnp:recordedStartDateTime'],
            duration: data['upnp:recordedDuration']
         },
         booked: {
            time: data['vx:X_bookingTime'],
            type: data['vx:X_bookingType'],
            active: data['vx:X_bookingActive'],
            keep: data['vx:X_bookingKeep'],
         },
         flags: {
            isHd: (data['vx:X_flags']['$'].hd == '1'),
            hasForeignSubtitles: (data['vx:X_flags']['$'].hasForeignSubtitles == '1'),
            hasAudioDesc: (data['vx:X_flags']['$'].hasAudioDesc == '1'),
            widescreen: (data['vx:X_flags']['$'].widescreen == '1'),
            isLinked: (data['vx:X_flags']['$'].isLinked == '1'),
            currentSeries: (data['vx:X_flags']['$'].currentSeries == '1'),
            is3D: (data['vx:X_flags']['$'].is3D == '1'),
            isAdult: (data['vx:X_flags']['$'].isAdult == '1'),
            isFirstRun: (data['vx:X_flags']['$'].firstRun == '1')
          }
      };
      return item;
   };

   this.getPlannerItems = function (offset) {
      if (!offset) offset = 0;
      var deferred = q.defer();
      //
      var soapPayload = {
         ObjectID: 3,
         BrowseFlag: 'BrowseDirectChildren',
         Filter: '*',
         StartingIndex: offset,
         RequestedCount: 25,
         SortCriteria: []
      };
      //
      box.soapRequest(SkyPlusHD_Settings.Services.SkyBrowse,'Browse',soapPayload)
         .then(function(response) {
            if (!offset) self.updateID = +response.UpdateID;
            var items = _.map(response.Result['DIDL-Lite'].item,parsePlannerItem);
            if (+response.NumberReturned+offset < +response.TotalMatches) {
               self.getPlannerItems(offset+soapPayload.RequestedCount)
                  .then(function(items2) {
                     items = items.concat(items2);
                     deferred.resolve(items);
                  }).done();
            } else {
               deferred.resolve(items);
            };
         }).done();
      //
      return deferred.promise;
   };
   //

   this.findResource = function(res) {
      var deferred = q.defer();
      self.getPlannerItems()
         .then(function(items) {
            var found = _.findWhere(items,{
               resource: res
            });
            if (found) {
               deferred.resolve(found);
            } else {
               deferred.reject('Resource not found in planner items');
            };
         })
         .fail(function() {
            deferred.reject('Failed to retreive planner items');
         })
         .done();
      return deferred.promise;
   };

};

/* ==== */

var skyFinder = new SkyPlusHD().find();

skyFinder.then(function(skyBox) {
   console.log("READY: "+skyBox.description);
   console.log("Reading planner...");
   skyBox.planner.getPlannerItems().then(function(items) {
      console.log('Planner contains '+items.length + ' items');
   });
   skyBox.on('stateChanged',function(playEvent) {
      console.log(util.format(">>> State:[%s] URI:[%s] Speed:[%s]",playEvent.TransportState,playEvent.CurrentTrackURI,playEvent.TransportPlaySpeed));
   });
});

skyFinder.fail(function(err) {
   console.log("Failed to find skybox, "+err);
});
