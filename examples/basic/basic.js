#!/usr/bin/env node

var Sky = require('../..');

var sky = new Sky();

sky.on('change',function(change) {
   console.log();
   console.log(change);
   console.log();
});

sky.on('ready',function() {
   sky.monitor();
});

process.on('exit',function() {
  sky.cancelSubscription();
}).on('SIGINT',function() {
  process.exit();
});
