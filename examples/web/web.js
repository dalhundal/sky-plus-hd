#!/usr/bin/node

var app = require('express')(),
   server = require('http').createServer(app),
   io = require('socket.io').listen(server);

var express = require('express');
var Sky = require('../../lib/sky-plus-hd.js').Sky;

app.use(express.static('static'));
app.get('/',function(req,res) { res.sendfile('static/index.html'); });

io.sockets.on('connection',function(socket) {
   if (changes.length) {
      socket.emit('changes',changes);
   };
   socket.on('changeChannel',function(channel) {
      console.log("change channel to ",channel);
      sky.changeChannel(channel);
   });
});

/* ==== */

var sky = new Sky({
   host: '192.168.1.193',
   port: 49153
});

var changes = [];
sky.on('change',function(data) {
   console.log("RECEIVED CHANGE");
   var saveData = {
      ts: new Date().valueOf(),
      data: data
   };
   changes.push(saveData);
   io.sockets.emit('change',saveData);
});

sky.monitor();
server.listen(55580);

/* ===== */
