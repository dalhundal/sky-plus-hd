#!/usr/bin/node

var XML = require('xml'),
    _ = require('underscore'),
    http = require('http'),
    dgram = require('dgram');


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
          callback(chunk);
        });
    });
    req.write(body);
    req.end();
    req.on('error',function(e) {
      console.log("ERROR IN COMMS",e.message,e);
    });
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

};

/* ==== */

var s = new Sky({
  host: '192.168.1.193',
  port: 49153
});

s.play();