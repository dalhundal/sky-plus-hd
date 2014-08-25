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

var XmlParser = function(xml) {

   function cleanupXml(o) {
      var ret;
      if (!_.isObject(o) && _.isArray(o)) {
         ret = [];
      } else if (_.isObject(o)) {
         ret = {};
      } else {
         return o;
      };
      _.each(o,function(v,k) {
         if (!_.isObject(v) && !_.isArray(v)) {
            ret[k] = v;
         } else if (_.isArray(v)) {
            if (v.length==1) {
               ret[k] = cleanupXml(v[0]);
            } else {
               ret[k] = cleanupXml(v);
            };
         } else if (_.isObject(v)) {
            ret[k] = cleanupXml(v);
         };
      });
      return ret;
   };

   var deferred = q.defer();
   xml2js.parseString(xml,function(err,results) {
      if (err) {
         deferred.reject(err);
      } else {
         deferred.resolve(cleanupXml(results));
      };
   });
   return deferred.promise;
};

q.longStackSupport = true;

/* ===== */


var SkyPlusHD = module.exports = function() {

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
      ownPort: 65432,
      regionCode: '4101-1'
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
   this.state = new SkyPlusHDState();
   this.sid = undefined;
   this.listeningSocket = undefined;
   //
   this.fetchDescriptionXml = function (url) {
      var deferred = q.defer();
      SkyBoxRequest(url,function(err,msg,body) {
         if (err) {
            deferred.reject(new Error(err));
         } else {
            XmlParser(body).fail(function(err) {
               deferred.reject(err)
            }).then(function(result) {
               if (result.root.device.manufacturer != "Sky") {
                 console.log('Skipping a non-sky upnp device');
               } else {
                  self.details = {
                     modelDescription: result.root.device.modelDescription,
                     modelName: result.root.device.modelName,
                     modelNumber: result.root.device.modelNumber,
                     friendlyName: result.root.device.friendlyName,
                     manufacturer: result.root.device.manufacturer
                  };
                  self.description = util.format("%s %s [model: %s] [software: %s] at %s:%d",self.details.manufacturer, self.details.modelName, self.details.modelDescription, self.details.modelNumber, options.ip, options.port);
                  //
                  _.each(result.root.device.serviceList.service,function(serviceNode) {
                  self.services[serviceNode.serviceType] = {
                        serviceType: serviceNode.serviceType,
                        serviceId: serviceNode.serviceId,
                        SCPDURL: serviceNode.SCPDURL,
                        controlURL: serviceNode.controlURL,
                        eventSubURL: serviceNode.eventSubURL
                     };
                  });
               }
               //
               deferred.resolve();
            }).done();
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
            XmlParser(chunks).then(function(result) {
               XmlParser(result['e:propertyset']['e:property'].LastChange).then(function(results) {
                  var ev = {
                     TransportState: results.Event.InstanceID.TransportState['$'].val,
                     CurrentTrackURI: results.Event.InstanceID.CurrentTrackURI['$'].val,
                     TransportPlaySpeed: results.Event.InstanceID.TransportPlaySpeed['$'].val,
                     AVTransportURI: results.Event.InstanceID.AVTransportURI['$'].val,
                     TransportStatus: results.Event.InstanceID.TransportStatus['$'].val,
                  }
                  self.emit('stateChanged',ev);
                  self.state.set(ev);
               }).done();
            }).done();
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
            XmlParser(body).fail(function(err) {
               deferred.reject(err);
            }).then(function(result) {
               var obj = result['s:Envelope']['s:Body'][util.format('u:%sResponse',method)];
               if (!obj) {
                  deferred.reject('Error - transport may be locked');
                  return;
               };
               var outObj = {};
               for (var i in obj) {
                  if (i=='$' || i=='Result') continue;
                  outObj[i] = obj[i]
               };
               if (obj['Result']) {
                  XmlParser(obj['Result']).fail(function(err) {
                     deferred.reject(err);
                  }).then(function(result) {
                     outObj.Result = result;
                     deferred.resolve(outObj);
                  }).done();
               } else {
                  deferred.resolve(outObj);
               };
            }).done();
         };
      });
      return deferred.promise;
   };
   //
   this.setChannel = function(properties) {
      var deferred = q.defer();
      if (!_.isObject(properties)) properties = {number:properties};
      findChannel(properties)
         .fail(function(err) {
            deferred.resolve(err);
         })
         .then(function(channel) {
            console.log("Changing channel to "+channel.name+" ("+channel.number+")");
            var soapPayload = {
               InstanceID: 0,
               CurrentURI: util.format("xsi://%s",channel.idHex),
               CurrentURIMetaData:'NOT_IMPLEMENTED'
            };
            self.soapRequest(SkyPlusHD_Settings.Services.SkyPlay,'SetAVTransportURI',soapPayload)
               .fail(function(err) {
                  deferred.reject(err);
               })
               .then(function(response) {
                  deferred.resolve();
               }).done();
         }).done();
      return deferred.promise;
   };
   //
   this.pause = function() {
      var deferred = q.defer();
      var soapPayload = {
         InstanceID: 0
      };
      self.soapRequest(SkyPlusHD_Settings.Services.SkyPlay,'Pause',soapPayload)
         .fail(function(err) {
            deferred.reject(err);
         })
         .then(function(response) {
            deferred.resolve();
         }).done();
      return deferred.promise;
   };
   //
   var findChannel = this.findChannel = function(properties) {
      var deferred = q.defer();
      getChannelList()
         .fail(function(err) {
            deferred.reject(err);
         })
         .then(function(channels) {
            var channel = _.findWhere(channels,properties);
            if (channel) {
               deferred.resolve(channel);
            } else {
               deferred.reject("Channel not found "+JSON.stringify(properties));
            };
         }).done();
      return deferred.promise;
   };
   //
   var getChannelList = this.getChannelList = _.memoize(function() {
      var deferred = q.defer();
      request(util.format("http://tv.sky.com/channel/index/%s",options.regionCode),function(err,msg,body) {
         if (err) {
            deferred.reject(err);
            return;
         };
         var listData = JSON.parse(body);
         var channels = _.map(listData.init.channels,function(channelData) {
            return new SkyPlusHDChannel(self,{
               name: channelData.t,
               nameLong: channelData.lcn || channelData.t,
               number: channelData.c[1],
               id: channelData.c[0]
            });
         });
         console.log(util.format("Loaded %d channel definitions",channels.length));
         deferred.resolve(channels);
      });
      return deferred.promise;
   });
   //
   self.state.on('change:CurrentTrackURI',function(val) {
      if (val.match(/^file/)) {
         self.planner.findResource(val).then(function(item) {
            console.log("Now playing: "+item.title);
         }).done();
      } else if (val.match(/^xsi:\/\/(.*)/)) {
         getChannelList().then(function(channelList) {
            var channelHexIdMatch = val.match(/^xsi:\/\/(.*)/);
            var channel = findChannel({idHex:channelHexIdMatch[1]})
               .fail(function(err) {
                  console.log(err);
               })
               .then(function(channel) {
                  self.emit('channelChanged',channel);
                  console.log("Channel: "+channel.name+" ("+channel.number+")");   
               }).done();
         }).done();
      };
      //
   });
   //
   q.all(_.map(options.xml,function(xmlUrl) {
      return self.fetchDescriptionXml(xmlUrl);
   })).then(function() {
      subscribe()
         .then(function(response) {
            self.emit('ready');
         }).done();
   }).done();
};
util.inherits(SkyPlusHDBox,events.EventEmitter);

/* ==== */

var SkyPlusHDChannel = function(skyBox,properties) {
   
   properties = properties || {};
   
   this.name = properties.name;
   this.nameLong = properties.nameLong || properties.name;
   this.number = properties.number;
   this.id = properties.id;
   this.idHex = this.id ? (+this.id).toString(16).toUpperCase() : undefined;

   //
   this.view = function() {
      var deferred = q.defer();
      skyBox.setChannel(this.number)
         .fail(function(err) {
            deferred.reject(err);
         })
         .then(function() {
            deferred.resolve();
         }).done();
      return deferred.promise;
   };

};

/* ==== */

var SkyPlusHDState = function() {
   var self = this;
   var state = {};

   this.set = function (stateObj) {
      var changed = {};
      var hasChanged = false;
      _.each(stateObj,function(val,key) {
         if (state[key] !== val) {
            hasChanged = true;
            changed[key] = val;;
            state[key] = val;
         };
      });
      if (hasChanged) {
         _.each(changed,function(val,key) {
            self.emit('change:'+key,val);
         });
         console.log(changed);
      };
      self.emit('change',changed);
   };
};
util.inherits(SkyPlusHDState,events.EventEmitter);

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

/*
var skyFinder = new SkyPlusHD().find();

skyFinder.then(function(skyBox) {
   console.log("READY: "+skyBox.description);
   console.log("Reading planner...");
   
   //skyBox.planner.getPlannerItems().then(function(items) {
   //   console.log('Planner contains '+items.length + ' items');
   //});
   
   skyBox.on('stateChanged',function(playEvent) {
      console.log(util.format(">>> State:[%s] URI:[%s] Speed:[%s]",playEvent.TransportState,playEvent.CurrentTrackURI,playEvent.TransportPlaySpeed));
   });
});

skyFinder.fail(function(err) {
   console.log("Failed to find skybox, "+err);
});
*/
