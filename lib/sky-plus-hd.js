var _ = require('underscore'),
  dgram = require('dgram'),
  http = require('http'),
  entities = new (require('html-entities').AllHtmlEntities)(),
  EventEmitter = require('events').EventEmitter,
  os = require('os'),
  util = require('util'),
  winston = require('winston'),
  xml = require('xml'),
  xmlparser = require('xml2json');

/* ====== */

var SkyPlusHD = module.exports = function(options) {

  /* ===== DEFAULT OPTIONS ===== */

  var defaultOptions = {
    host: null,
    port: 49153,
    monitorHost: null,
    monitorPort: 55555,
    log: 'info'
  };
  options = _.extend(defaultOptions,options||{});

  /* ===== LOGGER ===== */
  var logger = new winston.Logger({
    transports: [
      new winston.transports.Console({
        colorize: true,
        level: options.log,
        silent: !(options.log)
      })
    ]
  });

  /* ==== PRIVATE VARS ===== */
  var that = this;

  var channelsData;
  var lastURI;
  var subscriptionSid;

  /* ==== INIT ===== */
  var _init_ = function() {
    if (!options.monitorHost) {
      options.monitorHost = guessLocalIP();
    }
    if (!options.host) {
      that.detect(function(data) {
        options.host = data.address;
        that.emit('ready');
      });
    } else {
      that.emit('ready');
    }
  };

  /* ==== PRIVATE ===== */

  var changeChannelId = function(id,fnCallback) {
    changeChannelHexId(id.toString(16),fnCallback);
  };

  var changeChannelHexId = function(hexId,fnCallback) {
    var xml = generateRequestXML([
      {'u:SetAVTransportURI':[
        {'_attr':{
          'xmlns:u': 'urn:schemas-nds-com:service:SkyPlay:2'
        }},
        {
          'InstanceID': 0
        },
        {
          'CurrentURI': 'xsi://'+hexId
        },
        {
          'CurrentURIMetaData': 'NOT_IMPLEMENTED'
        }
      ]}
    ]);
    soapRequest("SkyPlay:2#SetAVTransportURI",xml,'/SkyPlay2',function(response) {
      _.isFunction(fnCallback) && fnCallback(response);
    });
  };

  var fetchChannelListingPart = function(channelId,date,part,fnCallback) {
    var httpParams = {
      host: 'tv.sky.com',
      port: 80,
      path: '/programme/channel/'+channelId+'/'+date+'/'+part+'.json'
    };
    var progs = [];
    var req = http.request(httpParams,function(res) {
      res.setEncoding('utf8');
      var chunks = "";
      res.on('data',function(chunk) { chunks = chunks+chunk; });
      res.on('end',function() {
        var parsed = JSON.parse(chunks);
        for (var i in parsed.listings[channelId]) {
          var prog = parsed.listings[channelId][i];
          progs.push(parseProgram(prog));
        }
        fnCallback(progs);
      });
    });
    req.end();
  };

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
    return '<?xml version="1.0" encoding="utf-8"?>'+xml(json);
  };

  var getChannel = function(number) {
    return _.find(loadChannelList(),function(c) {
      return c.channel === number;
    });
  };

  var getChannelById = function(id) {
    return _.find(loadChannelList(),function(c) {
      return c.channelId === id;
    });
  };

  var getChannelByHexId = function(hexId) {
    return _.find(loadChannelList(),function(c) {
      return c.channelHexId === hexId.toUpperCase();
    });
  };

  var getURIInformation = function(uri) {
    var info;
    if (uri.match(/^xsi:\/\//)) {
      var channelHexId = uri.replace(/^xsi:\/\//,'');
      info = {
        broadcast: true,
        channel: getChannelByHexId(channelHexId)
      };
    } else if (uri.match(/^file:\/\/pvr\//)) {
      var pvrHexId = uri.replace(/^file:\/\/pvr\//,'');
      info = {
        broadcast: false,
        pvrHexId: pvrHexId,
        pvrId: parseInt(pvrHexId,16)
      };
    }
    return info;
  };

  var guessLocalIP = function() {
    logger.info('Guessing local IP...');
    var ifaces=os.networkInterfaces();
    for (var dev in ifaces) {
      for (var i in ifaces[dev]) {
        var details = ifaces[dev][i];
        if (details.family==='IPv4' && !details.internal) {
          logger.info('Guessed local IP as being',details.address);
          return details.address;
        }
      }
    }
    logger.warn('Could not guess local IP');
  };

  var loadChannelList = function () {
    if (channelsData) {
      return channelsData;
    }
    var filename='./channels.json';
    var channelsDataRaw = require(filename);
    channelsData = [];
    _.each(channelsDataRaw.init.channels,function(channelDataRaw) {
      channelsData.push(parseChannel(channelDataRaw));
    });
    return channelsData;
  };

  var notificationsSubscribe = function(host,port,fnCallback) {
    var subscriptionId = "/sky/monitor/NOTIFICATION/"+(new Date().valueOf());
    logger.info("Requesting subscribition to notifications...");
    var httpParams = {
      host: options.host,
      port: options.port,
      path: '/SkyPlay2',
      method: 'SUBSCRIBE',
      headers: {
        callback: "<http://"+host+":"+port+subscriptionId+">",
        nt: 'upnp:event'
      }
    };
    var req = http.request(httpParams,function(res) {
      res.setEncoding('utf8');
      var chunks = "";
      res.on('data',function(chunk) { chunks = chunks+chunk; });
      res.on('end',function() {
        _.isFunction(fnCallback) && fnCallback();
      });
      subscriptionSid = res.headers.sid || null;
      //
      logger.info("Subscribed to notifications");
      logger.info("  - sid: ",subscriptionSid);
      logger.info("  - subscriptionId: ",subscriptionId);
    });
    req.end();
    return subscriptionId;
  };

  var notificationsUnsubscribe = function(host,port,fnCallback) {
    if (!subscriptionSid) {
      logger.info("Not subscribed to notifications");
      return;
    }
    logger.info("Unsubscribing from notifications...");
    var httpParams = {
      host: options.host,
      port: options.port,
      path: '/SkyPlay2',
      method: 'UNSUBSCRIBE',
      headers: {
        SID: subscriptionSid
      }
    };
    subscriptionSid = null;

    var req = http.request(httpParams,function(res) {
      res.setEncoding('utf8');
      var chunks = "";
      res.on('data',function(chunk) { chunks = chunks+chunk; });
      res.on('end',function() {});
      logger.info("Unsubscribed from notifications");
      logger.info("  - sid: ",subscriptionSid);
      _.isFunction(fnCallback) && (fnCallback(res));
    });
    req.end();
  };

  var parseChannel = function (channelDataRaw) {
    return {
      name: channelDataRaw.t,
      channel: channelDataRaw.c[1],
      channelId: channelDataRaw.c[0],
      channelHexId: channelDataRaw.c[0].toString(16).toUpperCase(),
      isHD: channelDataRaw.c[3]?true:false
    };
  };

  var parseProgram = function(programDataRaw) {
    return {
      start: new Date(programDataRaw.s*1000),
      end: new Date((programDataRaw.s+programDataRaw.m[1]-1)*1000),
      title: programDataRaw.t,
      description: programDataRaw.d,
      duration: programDataRaw.m[1]/60,
      image: (programDataRaw.img) ? 'http://epgstatic.sky.com/epgdata/1.0/paimage/18/0/'+programDataRaw.img : undefined,
      url: programDataRaw.url
    };
  };

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
  };

  var transmitMSearch = function() {
    logger.info("Requesting for any SKY+HD boxes on the LAN to make themselves known");
    var message = new Buffer([
      'M-SEARCH * HTTP/1.1',
      'HOST: 239.255.255.250:1900',
      'MAN: "ssdp:discover"',
      'ST: ssdp:all',
      'MX: 1',
      '',''
    ].join("\r\n"));
    var client = dgram.createSocket("udp4");
    client.bind(1900); // So that we get a port so we can listen before sending
    client.send(message, 0, message.length, 1900, "239.255.255.250",function(err,bytes) {
      client.close();
    });
  };

  /* ==== PUBLIC ===== */

  this.changeChannel = function(num) {
    var c = getChannel(num);
    logger.info("Changing channel to: ("+c.channel+") "+c.name);
    changeChannelHexId(c.channelHexId);
  };

  this.close = function() {
    logger.info("Starting graceful shutdown");
    notificationsUnsubscribe();
    logger.info("Bye");
  };

  this.detect = function(fnCallback) {
    logger.info("Trying to auto-detect SKY+HD box...");
    var server = dgram.createSocket('udp4');
    server.on('message',function(msg,rinfo) {
      if (String(msg).indexOf('redsonic') > 1) {
        logger.info("SKY+HD box found at",rinfo.address);
        fnCallback({
          address: rinfo.address
        });
        server.close();
      }
    });
    server.bind(1900);
    transmitMSearch();
  };

  this.getChannelListing = function (channelId,fnCallback) {
    var now = new Date(),
      year = now.getFullYear(),
      month = now.getUTCMonth() + 1,
      date = now.getUTCDate(),
      dateStr = year +'-'+ (month>9?month:'0'+month) +'-'+ (date>9?date:'0'+date),
      progs = [];

    var runCallback = _.after(4,function() {
      progs = progs.sort(function(a,b) {
        if (a.start.valueOf() === b.start.valueOf()) return 0;
        return (a.start.valueOf() > b.start.valueOf()) ? 1 : -1;
      });
      fnCallback(progs);
    });

    _.times(4,function(i) {
      fetchChannelListingPart(channelId,dateStr,i,function(progs_i) {
        progs = progs.concat(progs_i);
        runCallback();
      });
    });
  };

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
  };

  this.monitor = function() {
    var that = this;
    var subscriptionId = notificationsSubscribe(options.monitorHost,options.monitorPort);
    //
    http.createServer(function(req,res) {
      if (req.url !== subscriptionId) {
         res.writeHead(404,{'Content-Type':'text/plain'});
         res.end();
         return;
      }
      var chunks = "";
      req.on('data',function(chunk) { chunks += chunk; });
      req.on('end',function() {
        var jsonData = JSON.parse(xmlparser.toJson(chunks,{sanitize:false}));
        var notificationRaw = jsonData['e:propertyset']['e:property']['LastChange'];
        notificationRaw = notificationRaw.replace(/([^=])"([a-zA-Z])/g,'$1" $2'); // WORKAROUND FOR ILL FORMED XML, ATTRIBUTES FOR A NODE HAVE A SPACE MISSING BETWEEN THEM, THIS RESTORES IT
        var notificationXML = entities.decode(entities.decode(notificationRaw));
        var notificationJSON = JSON.parse(xmlparser.toJson(notificationXML)).Event.InstanceID;
        //
        if (!notificationJSON.CurrentTrackURI) {
          return;
        }
        var currentURI = notificationJSON.CurrentTrackURI.val;
        if (currentURI !== lastURI) {
          lastURI = currentURI;
          var uriInformation = getURIInformation(currentURI);
          that.whatsOn(uriInformation.channel.channelId,function(whatsOn) {
            var ev = uriInformation;
            ev.program = whatsOn;
            that.emit('change',ev);
            //
            logger.info('Change notification received at '+(new Date()).toString());
            logger.info('  - ('+ev.channel.channel+') '+ev.channel.name);
            logger.info('  - '+ev.program.now.title);
            logger.info('  - '+ev.program.now.start+' - '+ev.program.now.end);
            logger.info('  - '+ev.program.now.duration+' mins');
          });
        }
      });
      res.writeHead(200,{'Content-Type':'text/plain'});
      res.end('OK');
    }).listen(options.monitorPort);
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
    logger.info("Sending command: PAUSE");
    soapRequest("SkyPlay:2#Pause",xml,'/SkyPlay2',function(response) {
      logger.info("Sent command: PAUSE");
    });
  };

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
    logger.info("Sending command: PLAY");
    soapRequest("SkyPlay:2#Play",xml,'/SkyPlay2',function(response) {
      logger.info("Sent command: PLAY");
    });
  };

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
  };

  /* ===== */
  _init_();

};

util.inherits(SkyPlusHD,EventEmitter);