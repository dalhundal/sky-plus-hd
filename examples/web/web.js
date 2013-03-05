#!/usr/bin/env node

var options = {
   skyBox: 'sky', // IP or Hostname of the Sky+ HD box
   httpPort: 55580 // Port to run web server on
}

/* ===== */

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

var sky = new Sky({ host: options.skyBox });

var changes = [];
sky.on('change',function(data) {
   var saveData = {
      ts: new Date().valueOf(),
      data: data
   };
   changes.push(saveData);
   io.sockets.emit('change',saveData);
});

sky.monitor();
server.listen(options.httpPort);

process.on('exit',function() {
  sky.cancelSubscription();
}).on('SIGINT',function() {
  process.exit();
});
/* ===== */
