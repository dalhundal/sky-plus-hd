var util = require('util');
var SkyPlusHD = require('../..');

var skyFinder = new SkyPlusHD().find();

skyFinder.then(function(skyBox) {
   console.log("READY: "+skyBox.description);

   /*
   console.log("Reading planner...");
   skyBox.planner.getPlannerItems().then(function(items) {
      console.log('Planner contains '+items.length + ' items');
   });
   */
   skyBox.on('stateChanged',function(playEvent) {
      console.log(util.format(">>> State:[%s] URI:[%s] Speed:[%s]",playEvent.TransportState,playEvent.CurrentTrackURI,playEvent.TransportPlaySpeed));
   });
});

skyFinder.fail(function(err) {
   console.log("Failed to find skybox, "+err);
});