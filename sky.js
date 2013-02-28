#!/usr/bin/node

var XML = require('xml'),
    _ = require('underscore'),
    http = require('http'),
    dgram = require('dgram'),
    xmlparser = require('xml2json');


var Sky = function(options) {

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

  var request = function (soapAction,body,path,callback) {
    var httpParams = {
      hostname: options.host,
      port: options.port,
      path: options.overridePath || path,
      method: 'POST',
      headers: {
        'USER-AGENT': 'SKY_skyplus',
        'SOAPACTION': '"urn:schemas-nds-com:service:'+soapAction+'"',
        'CONTENT-TYPE': 'text/xml; charset="utf-8"'
      }
    };
    var req = http.request(httpParams, function(res) {
        res.setEncoding('utf8');
        res.on('data',function(chunk) {
          callback(JSON.parse(xmlparser.toJson(chunk))['s:Envelope']['s:Body']);
        });
    });
    req.write(body);
    req.end();
    req.on('error',function(e) {
      console.log("ERROR IN COMMS",e.message,e);
    });
  }

  var getChannelListingPart = function(channelID,date,part,fnCallback) {
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
          progs.push({
            date: new Date(prog.s*1000),
            title: prog.t,
            description: prog.d,
            duration: prog.m[1]/60
          });
        }
        fnCallback(progs);
      })
    });
    req.end();
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
    request("SkyPlay:2#Play",xml,'/SkyPlay2',function(response) {
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
    request("SkyPlay:2#Pause",xml,'/SkyPlay2',function(response) {
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
    request("SkyPlay:2#SetAVTransportURI",xml,'/SkyPlay2',function(response) {
      console.log(response);
    });
  }

  this.changeChannelID = function (id) {
    return this.changeChannelHexID(id.toString(16));
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
    request("SkyPlay:2#GetMediaInfo",xml,'/SkyPlay2',function(response) {
      var currentURI = response['u:GetMediaInfoResponse']['CurrentURI'].replace(/^xsi:\/\//,'');
      fnCallback({
        channelHexID: currentURI,
        channelID: parseInt(currentURI,16)
      })
    });
  }

  this.getChannelListing = function (channelID,fnCallback) {
    var now = new Date(),
      year = now.getFullYear(),
      month = now.getUTCMonth() + 1,
      date = now.getUTCDate(),
      dateStr = year +'-'+ (month>9?month:'0'+month) +'-'+ (date>9?date:'0'+date),
      progs = [];

    getChannelListingPart(channelID,dateStr,0,function(progs0) {
      getChannelListingPart(channelID,dateStr,1,function(progs1) {
        getChannelListingPart(channelID,dateStr,2,function(progs2) {
          getChannelListingPart(channelID,dateStr,3,function(progs3) {
            progs = progs.concat(progs0,progs1,progs2,progs3);
            fnCallback(progs);
          });
        });
      });
    });
  }

  this.whatsOn = function (channelId,date,fnCallback) {
    this.getChannelListing(channelId,function(progs) {
      for (var i in progs) {
        if (progs[i].date > date) {
          fnCallback(progs[Math.max(0,i-1)]);
          break;
        };
      };
    });
  }

};

/* ==== */

var s = new Sky({
  host: '192.168.1.193',
  port: 49153
});

s.getMediaInfo(function(data) {
  s.whatsOn(data.channelID, new Date(), function(data) {
    console.log(data);
  });
});

