#!/usr/bin/node

var XML = require('xml'),
    _ = require('underscore'),
    http = require('http'),
    dgram = require('dgram'),
    xmlparser = require('xml2json');
    Entities = require('html-entities').AllHtmlEntities,
    entities = new Entities(),
    util = require('util'),
    EventEmitter = require('events').EventEmitter;


var Sky = exports.Sky = function(options) {

  var generateRequestXML = function(content) {
    var json = [
      {'s:Envelope': [
        {'_attr': {
          's:encodingStyle': 'http://schemas.xmlsoap.org/soap/encoding/',
          'xmlns:s': 'http://schemas.xmlsoap.org/soap/envelope/'
        }},
        {'s:Body':content}
      ]}
    ];
    return '<?xml version="1.0" encoding="utf-8"?>'+XML(json);
  }

  var soapRequest = function (soapAction,body,path,fnCallback) {
    var httpParams = {
      hostname: options.host,
      port: options.port,
      path: path,
      method: 'POST',
      headers: {
        'USER-AGENT': 'SKY_skyplus',
        'SOAPACTION': '"urn:schemas-nds-com:service:'+soapAction+'"',
        'CONTENT-TYPE': 'text/xml; charset="utf-8"'
      }
    };
    var req = http.request(httpParams, function(res) {
        res.setEncoding('utf8');
        var chunks = "";
        res.on('data',function(chunk) {
          chunks = chunks+chunk;
        });
        res.on('end',function() {
          fnCallback(JSON.parse(xmlparser.toJson(chunks))['s:Envelope']['s:Body']);
        });
    });
    req.write(body);
    req.end();
    req.on('error',function(e) {
      console.log("ERROR IN COMMS",e.message,e);
    });
  }

  var parseProgram = function(prog) {
    return {
      start: new Date(prog.s*1000),
      end: new Date((prog.s+prog.m[1]-1)*1000),
      title: prog.t,
      description: prog.d,
      duration: prog.m[1]/60
    };
  }

  var fetchChannelListingPart = function(channelID,date,part,fnCallback) {
    var httpParams = {
      host: 'tv.sky.com',
      port: 80,
      path: '/programme/channel/'+channelID+'/'+date+'/'+part+'.json'
    };
    var progs = [];
    var req = http.request(httpParams,function(res) {
      res.setEncoding('utf8');
      var chunks = "";
      res.on('data',function(chunk) { chunks = chunks+chunk; });
      res.on('end',function() {
        var parsed = JSON.parse(chunks);
        for (var i in parsed.listings[channelID]) {
          var prog = parsed.listings[channelID][i];
          progs.push(parseProgram(prog));
        }
        fnCallback(progs);
      })
    });
    req.end();
  }

  var channelsData;
  var loadChannelList = function () {
    if (channelsData) return channelsData;
    var filename='./channels.json';
    var channelsDataRaw = require(filename);
    channelsData = [];
    _.each(channelsDataRaw.init.channels,function(channelDataRaw) {
      channelsData.push({
        name: channelDataRaw.t,
        channel: channelDataRaw.c[1],
        channelID: channelDataRaw.c[0],
        channelHexID: channelDataRaw.c[0].toString(16).toUpperCase(),
        isHD: channelDataRaw.c[3]?true:false
      });
    });
    return channelsData;
  };

  var getChannel = function(number) {
    return _.find(loadChannelList(),function(c) {
      return c.channel == number;
    });
  };

  var getChannelByID = function(ID) {
    return _.find(loadChannelList(),function(c) {
      return c.channelID == ID;
    });
  };

  var getChannelByHexID = function(hexID) {
    return _.find(loadChannelList(),function(c) {
      return c.channelHexID == hexID.toUpperCase();
    });
  };

  var getURIInformation = function(uri) {
    var info;
    if (uri.match(/^xsi:\/\//)) {
      var channelHexID = uri.replace(/^xsi:\/\//,'');
      info = {
        broadcast: true,
        channel: getChannelByHexID(channelHexID)
      }
    } else if (uri.match(/^file:\/\/pvr\//)) {
      var pvrHexID = currentURI.replace(/^file:\/\/pvr\//,'');
      info = {
        broadcast: false,
        pvrHexID: pvrHexID,
        pvrID: parseInt(pvrHexID,16)
      };
    }
    return info;
  }

  /* ==== */

  this.detect = function(fnCallback) {
    var server = dgram.createSocket('udp4');
    server.on('message',function(msg,rinfo) {
      if (String(msg).indexOf('redsonic') > 1) {
        fnCallback({
          address: rinfo.address
        });
        server.close();
      };
    });
    server.bind(1900);
  };

  /* ==== */

  this.play = function() {
    var xml = generateRequestXML([
      {'u:Play':[
        {'_attr':{
          'xmlns:u': 'urn:schemas-nds-com:service:SkyPlay:2'
        }},
        {
          'InstanceID':0
        },
        {
          'Speed': 1
        }
      ]}
    ]);
    soapRequest("SkyPlay:2#Play",xml,'/SkyPlay2',function(response) {
      console.log(response);
    });
  };

  this.pause = function() {
    var xml = generateRequestXML([
      {'u:Pause':[
        {'_attr':{
          'xmlns:u': 'urn:schemas-nds-com:service:SkyPlay:2'
        }},
        {
          'InstanceID':0
        }
      ]}
    ]);
    soapRequest("SkyPlay:2#Pause",xml,'/SkyPlay2',function(response) {
      console.log(response);
    });
  };

  this.changeChannelHexID = function (id) {
    var xml = generateRequestXML([
      {'u:SetAVTransportURI':[
        {'_attr':{
          'xmlns:u': 'urn:schemas-nds-com:service:SkyPlay:2'
        }},
        {
          'InstanceID': 0
        },
        {
          'CurrentURI': 'xsi://'+id
        },
        {
          'CurrentURIMetaData': 'NOT_IMPLEMENTED'
        }
      ]}
    ]);
    soapRequest("SkyPlay:2#SetAVTransportURI",xml,'/SkyPlay2',function(response) {
      console.log(response);
    });
  }

  this.changeChannelID = function (id) {
    return this.changeChannelHexID(id.toString(16));
  }

  this.changeChannel = function(num) {
    var c = getChannel(num);
    return this.changeChannelHexID(c.channelHexID);
  }

  this.getMediaInfo = function(fnCallback) {
    var xml = generateRequestXML([
      {'u:GetMediaInfo':[
        {'_attr':{
          'xmlns:u': 'urn:schemas-nds-com:service:SkyPlay:2'
        }},
        {
          'InstanceID':0
        }
      ]}
    ]);
    soapRequest("SkyPlay:2#GetMediaInfo",xml,'/SkyPlay2',function(response) {
      var currentURI = response['u:GetMediaInfoResponse']['CurrentURI'];
      fnCallback(getURIInformation(currentURI));
    });
  }

  this.getChannelListing = function (channelID,fnCallback) {
    var now = new Date(),
      year = now.getFullYear(),
      month = now.getUTCMonth() + 1,
      date = now.getUTCDate(),
      dateStr = year +'-'+ (month>9?month:'0'+month) +'-'+ (date>9?date:'0'+date),
      progs = [];

    var runCallback = _.after(4,function() {
      progs = progs.sort(function(a,b) {
        if (a.start.valueOf() == b.start.valueOf()) return 0;
        return (a.start.valueOf() > b.start.valueOf()) ? 1 : -1;
      });
      fnCallback(progs);
    });

    _.times(4,function(i) {
      fetchChannelListingPart(channelID,dateStr,i,function(progs_i) {
        progs = progs.concat(progs_i);
        runCallback();
      });
    });
  }

  this.whatsOn = function (channelId,fnCallback) {
    var httpParams = {
      host: 'epgservices.sky.com',
      port: 80,
      path: '/5.1.1/api/2.0/channel/json/'+channelId+'/now/nn/4'
    };
    var req = http.request(httpParams,function(res) {
      res.setEncoding('utf8');
      var chunks = "";
      res.on('data',function(chunk) { chunks = chunks+chunk; });
      res.on('end',function() {
        var parsed = JSON.parse(chunks);
        fnCallback({
          now: parseProgram(parsed.listings[channelId][0]),
          next: parseProgram(parsed.listings[channelId][1])
        });
      });
    });
    req.end();
  }

  var subscriptionSID = null;
  this.requestSubscription = function(host,port,fnCallback) {
    var subscriptionID = "/sky/monitor/NOTIFICATION/"+(new Date().valueOf());
    var httpParams = {
      host: options.host,
      port: options.port,
      path: '/SkyPlay2',
      method: 'SUBSCRIBE',
      headers: {
        callback: "<http://"+host+":"+port+subscriptionID+">",
        nt: 'upnp:event'
      }
    };
    var req = http.request(httpParams,function(res) {
      res.setEncoding('utf8');
      var chunks = "";
      res.on('data',function(chunk) { chunks = chunks+chunk; });
      res.on('end',function() {
        fnCallback();
      });
      subscriptionSID = res.headers.sid || null;
    });
    req.end();
    return subscriptionID;
  };

  this.cancelSubscription = function(host,port,fnCallback) {
    if (!subscriptionSID) {
      console.log("No subscription to cancel");
      return;
    };
    console.log("Cancelling subscription with SID:",subscriptionSID);
    var httpParams = {
      host: options.host,
      port: options.port,
      path: '/SkyPlay2',
      method: 'UNSUBSCRIBE',
      headers: {
        SID: subscriptionSID
      }
    };
    subscriptionSID == null;

    var req = http.request(httpParams,function(res) {
      res.setEncoding('utf8');
      var chunks = "";
      res.on('data',function(chunk) { chunks = chunks+chunk; });
      res.on('end',function() {});
    });
    req.end();
  };

  var lastURI = null;
  this.monitor = function() {
    var that = this;
    var monitorHost = '192.168.1.150';
    var monitorPort = 55555;
    var subscriptionID = this.requestSubscription(monitorHost,monitorPort,function() {
      console.log("Subscribed with SID:",subscriptionSID,"on port:",monitorPort,". SubscriptionID = ",subscriptionID);
    });
    //
    var monitorServer = http.createServer(function(req,res) {
      if (req.url != subscriptionID) {
         res.writeHead(404,{'Content-Type':'text/plain'});
         res.end();
         return;
      };
      var chunks = "";
      req.on('data',function(chunk) { chunks += chunk });
      req.on('end',function() {
        var jsonData = JSON.parse(xmlparser.toJson(chunks,{sanitize:false}));
        var notificationRaw = jsonData['e:propertyset']['e:property']['LastChange'];
        notificationRaw = notificationRaw.replace(/([^=])"([a-zA-Z])/g,'$1" $2'); // WORKAROUND FOR ILL FORMED XML, ATTRIBUTES FOR A NODE HAVE A SPACE MISSING BETWEEN THEM, THIS RESTORES IT
        var notificationXML = entities.decode(entities.decode(notificationRaw));
        var notificationJSON = JSON.parse(xmlparser.toJson(notificationXML)).Event.InstanceID;
        //
        if (!notificationJSON.CurrentTrackURI) {
          console.log(notificationJSON);
          return;
        };
        var currentURI = notificationJSON.CurrentTrackURI.val;
        if (currentURI != lastURI) {
          lastURI = currentURI;
          var uriInformation = getURIInformation(currentURI);
          that.whatsOn(uriInformation.channel.channelID,function(whatsOn) {
            var ev = uriInformation;
            ev.program = whatsOn;
            that.emit('change',ev);
          });
        };
      });
      res.writeHead(200,{'Content-Type':'text/plain'});
      res.end('OK');
    }).listen(monitorPort);
  };

};

util.inherits(Sky,EventEmitter);
/*

var s = new Sky({
  host: '192.168.1.193',
  port: 49153
});

s.on('change',function(ev) {
  console.log();
  console.log(new Date());
  if (ev.broadcast) {
    console.log("Current Channel: "+ev.channel.channel+", "+ev.channel.name);
    console.log("Program: "+ev.program.now.title);
    console.log("Synopsis: "+ev.program.now.description);
    console.log("Started: "+ev.program.now.start);
    console.log("Ends: "+ev.program.now.end);
  } else {
    console.log("Not watching a live channel");
  }
  console.log("-----");
  console.log();
});

s.monitor();



process.on('exit',function() {
  s.cancelSubscription();
}).on('SIGINT',function() {
  process.exit();
});

*/