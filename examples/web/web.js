#!/usr/bin/env node

var app = require('express')()
   ,server = require('http').createServer(app)
   ,io = require('socket.io').listen(server)
   ,express = require('express')
   ,Sky = require('../..');

app.use(express.static('static'));
app.get('/',function(req,res) { res.sendfile('static/index.html'); });

io.sockets.on('connection',function(socket) {
   if (changes.length) {
      socket.emit('changes',changes);
   };
   socket.on('changeChannel',function(channel) {
      sky.changeChannel(channel);
   });
});

/* ==== */

var sky = new Sky();

var changes = [];
sky.on('change',function(data) {
   var saveData = {
      ts: new Date().valueOf(),
      data: data
   };
   changes.push(saveData);
   io.sockets.emit('change',saveData);
});

sky.on('ready',function() {
   sky.monitor();
   server.listen(55580);
});

process.on('exit',function() {
  sky.close();
}).on('SIGINT',function() {
  process.exit();
});
