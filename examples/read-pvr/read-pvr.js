#!/usr/bin/env node

var Sky = require('../..');

var sky = new Sky();

sky.on('ready',function() {
   sky.readPlanner(function(plannerItems) {
      for (var i in plannerItems) {
         var plannerItem = plannerItems[i];
         console.log(+i+1+")",plannerItem.start);
         console.log(plannerItem.title);
         console.log("Viewed:",(plannerItem.viewed)?'YES':'NO');
         console.log("Size:",Math.round(plannerItem.size/1024/1024)+' mb');
         console.log("URI",plannerItem.uri);
         console.log("Duration",Math.floor(plannerItem.duration/60)+' mins');
         console.log("-----");
         console.log();
      };
   })
});