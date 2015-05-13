var celeri = require('celeri');
var moment = require('moment');
var Table = require('cli-table');
var util = require('util');

var SkyPlusHD = require('../..');
var SkyPlusHDChannelList = require('../../lib/sky-plus-hd_channel-list');

var findABox = SkyPlusHD.findBox(process.argv[2] || undefined);

findABox.then(function(box){
	celeri.open({
		prefix: util.format('%s@%s >', box.model, box.ip)
	});

	celeri.option({
		command: 'pause',
		description: "Pauses playback",
	},function() {
		var spinner = celeri.loading("Pausing");
		box.pause().then(function() {
			spinner.done(true);
		}).fail(function() {
			spinner.done(true);
		});
	});

	celeri.option({
		command: 'play',
		description: "Starts playback",
	},function() {
		var spinner = celeri.loading("Playing");
		box.play().then(function() {
			spinner.done(true);
		}).fail(function() {
			spinner.done(false);
		});
	});


	celeri.option({
		command: 'stop',
		description: "Stops playback",
	},function() {
		var spinner = celeri.loading("Stopping");
		box.stop().then(function() {
			spinner.done(true);
		}).fail(function() {
			spinner.done(false);
		});
	});

	celeri.option({
		command: 'rwd',
		description: "Rewinds @ 12x",
	},function() {
		var spinner = celeri.loading("Rewinding");
		box.play(-12).then(function() {
			spinner.done(true);
		}).fail(function() {
			spinner.done(false);
		});
	});

	celeri.option({
		command: 'fwd',
		description: "Forwards @ 12x",
	},function() {
		var spinner = celeri.loading("Forwarding");
		box.play(12).then(function() {
			spinner.done(true);
		}).fail(function() {
			spinner.done(false);
		});
	});


	celeri.option({
		command: 'channel :number',
		description: "Changes to specified channel number",
	},function(data) {
		var spinner = celeri.loading("Changing to channel...");
		box.setChannel(data.number).then(function() {
			spinner.done(true);
			//
		}).fail(function(err) {
			spinner.done(false);
			console.log(err);
		});
	});

	celeri.option({
		command: 'channel?',
		description: "Info about the current channel"
	},function() {
		box.whatsOn().then(function(channel) {
			console.log("%s on channel %d", channel.nameLong, channel.number);
		}).catch(function(err) {
			console.log("NOTOK",err);
		});
	});

	celeri.option({
		command: 'tvguide :channelNumber',
		description: 'Shows the schedule for specified channel number'
	}, function(data) {
		var spinner = celeri.loading("Retreiving schedule...");
		var channelList = new SkyPlusHDChannelList();
		channelList.init().then(function(x) {
			var channel = channelList.findChannel({number:+data.channelNumber});
			console.log(channel.name);
			channel.getSchedule().then(function(schedule) {
				var table = new Table({
					head: ['Start','Title']
				});
				_.each(schedule,function(prog) {
					table.push([moment(prog.start).format('HH:mm'), prog.title]);
				});
				console.log(table.toString());
				spinner.done();
			});
		});
	})

	celeri.option({
		command: 'planner',
		description: 'Read the planner'
	},function() {
		var spinner = celeri.loading("Reading the planner...");
		box.readPlanner().then(function(progs) {
			var table = new Table({
					head: ['Index','Resource','Title']
				});
			_.each(progs,function(prog,i) {
				table.push([i,prog.resource,prog.title]);
			});
			spinner.done();
			console.log(table.toString());
		}).done();
	});

	celeri.option({
		command: 'uri :schemehex :id',
		description: 'Specify a uri to play on the box'
	},function(data) {
		var spinner = celeri.loading("Setting URI to "+data.schemehex+"://"+data.id);
		box.setURI(util.format("%s://%s", data.schemehex, data.id)).then(function() {
			spinner.done();
		}).catch(function() {
			spinner.done(true);
		})
	});

	celeri.option({
		command: 'pvr :id',
	},function(data) {
		var spinner = celeri.loading("Playing pvr item "+util.format("file://pvr/%s", data.id));
		box.setURI(util.format("file://pvr/%s", data.id)).then(function() {
			spinner.done();
		}).catch(function() {
			spinner.done(true);
		})
	})

});

findABox.then(function(box) {
	console.log();
	console.log("Found a SkyPlusHD box!");
	console.log("        IP:",box.ip);
	console.log("     MODEL:",box.model);
	console.log("  CAPACITY:",box.capacity);
	console.log("  SOFTWARE:",box.software);
	console.log("    SERIAL:",box.serial);
	console.log("    PHOTOS:",box.supportsPhotoViewing ? 'Yes' : 'No');
	console.log();
});

findABox.fail(function(err) {
	console.log("Failed to find SkyPlusHD box",err);
});