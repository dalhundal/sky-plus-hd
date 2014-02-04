var celeri = require('celeri');
var util = require('util');
var SkyPlusHD = require('../..');


var skyFinder = new SkyPlusHD().find();

skyFinder.then(function(skyBox) {
   console.log("READY: "+skyBox.description);

   celeri.open({  
       prefix: 'sky-plus-hd > '
   });

   celeri.option({
      command: "channel :number",
      description: "Changes to the specified channel number",
   },function(data) {
      var spinner = celeri.loading("Changing to channel "+data.number);
      skyBox.setChannel({number:parseInt(data.number)}).then(function() {
         spinner.done();
      }).fail(function() {
         spinner.done(true);
      });
   });

   celeri.option({
      command: 'pause',
      description: "Pauses the currently playing programme",
   },function() {
      var spinner = celeri.loading("Pausing");
      skyBox.pause().then(function() {
         spinner.done();
      }).fail(function() {
         spinner.done(true);
      });
      skyBox.pause()
   });

   celeri.option({
      command: 'channelinfo :channel',
      description: "Show info for the specified channel"
   },function(data) {
      var spinner = celeri.loading("Getting channel info for "+data.channel);
      skyBox.findChannel({number:+data.channel}).then(function(channel) {
         spinner.done();
         var table = [channel];
         table.push({number:'======',name:'====',id:'==',idHex:'======'},{number:'NUMBER',name:'NAME',id:'ID',idHex:'ID HEX'});
         celeri.drawTable(table,{
            columns: ['number','name','id','idHex']
         });
      }).fail(function(err){
         spinner.done(true);
      });
   });

   celeri.option({
      command: 'channels',
      description: "Show info for all channels"
   },function(data) {
      var spinner = celeri.loading("Getting channels list");
      skyBox.getChannelList().then(function(channelList) {
         channelList.reverse();
         
         spinner.done();
         celeri.drawTable(channelList,{
            columns: ['number','name','id','idHex']
         });
      }).fail(function(err) {
         spinner.done(true);
      })
   })

   celeri.parse(process.argv);

   /*
   console.log("Reading planner...");
   skyBox.planner.getPlannerItems().then(function(items) {
      console.log('Planner contains '+items.length + ' items');
   });
   */
   /*
   skyBox.on('stateChanged',function(playEvent) {
      console.log(util.format(">>> State:[%s] URI:[%s] Speed:[%s]",playEvent.TransportState,playEvent.CurrentTrackURI,playEvent.TransportPlaySpeed));
   });
   */
});

skyFinder.fail(function(err) {
   console.log("Failed to find skybox, "+err);
});