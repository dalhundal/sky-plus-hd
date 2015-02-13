var celeri = require('celeri');
var util = require('util');
var SkyPlusHD = require('../..');

var findABox = SkyPlusHD.findBox('192.168.0.40');

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
		command: 'channel :number',
		description: "Changes to specified channel number",
	},function(data) {
		var spinner = celeri.loading("Changing to channel...");
		box.setChannel(data.number).then(function() {
			spinner.done(true);
		}).fail(function() {
			spinner.done(false);
		});
	});

	celeri.option({
		command: 'channel?',
		description: "Info about the current channel"
	},function() {
		box.whatsOn().then(function(channel) {
			console.log("%s on channel %d", channel.nameLong, channel.number);
		}).catch(function(err) {
			console.log("NOTOK");
		});
	});

	celeri.option({
		command: 'planner',
		description: 'Read the planner'
	},function() {
		box.readPlanner().then(function(progs) {
			console.log(_.map(progs,function(prog, i) {
				return prog.title;
			}));
		});
	});

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