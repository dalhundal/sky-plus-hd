"use strict";

var q = require('q');
var util = require('util');
var _ = require('underscore');

var SkyPlusHDChannelList = require('./sky-plus-hd_channel-list');
var SkyPlusHDEventListener = require('./sky-plus-hd_event-listener');
var SkyPlusHDHttpRequest = require('./sky-plus-hd_http-request');
var SkyPlusHDServiceDefinitions = require('./sky-plus-hd_service-definitions');
var SkyPlusHDXmlParser = require('./sky-plus-hd_xml-parser');

q.longStackSupport = true;

/**
 * SkyPlusHDBox - representation of a single physical SkyPlusHD box
 * @class
 */
var SkyPlusHDBox = function(params) {

	var self = this;
	var details = {};
	var services = {};
	var channelList = new SkyPlusHDChannelList();
	var currentState = null;

	Object.defineProperty(self, "ip", {
		get: function() {
			return params.ip;
		}
	});

	Object.defineProperty(self, "port", {
		get: function() {
			/* Not sure what the other port is for - always seems to actually be 49153 */
			return 49153;
			// return params.port;
		}
	});

	Object.defineProperty(self,"model",{
		get: function() {
			return details.model;
		}
	});

	Object.defineProperty(self,"capacity",{
		get: function() {
			return details.capacity;
		}
	});

	Object.defineProperty(self,"software",{
		get: function() {
			return details.software;
		}
	});

	Object.defineProperty(self,"serial",{
		get: function() {
			return details.serial;
		}
	});

	/*
	 * Boxes with model number started '4F31' and with software > R010
	 * support photo viewing
	 */
	Object.defineProperty(self,'supportsPhotoViewing',{
		get: function() {
			return (parseInt(details.software.match(/^R(\d+)\./)[1]) >= 10 && details.modelDescription.match(/^4F31/i));
		}
	});

	/**
	 * Return an absolute URL referencing the box's IP and port
	 * @private
	 * @param {String} path - path to be transformed into an absolute URL
	 * @private
	 */
	function url(path) {
		path = path || "";
		return util.format("http://%s:%d%s",self.ip,self.port,path);
	}

	/**
	 * Subscribe to event notifications from the device
	 * @private
	 * @returns {Promise} resolves when we are ready to receive notifications
	 */
	function subscribe() {
		var listener = new SkyPlusHDEventListener(
			url(services[SkyPlusHDServiceDefinitions.SkyPlay].eventSubURL)
		);
		listener.on('notification',function(ev) {
			currentState = ev;
			console.log(self.ip,"STATE",ev);
		});
		return listener.start();
	}

	/**
	 * Initialise the box: fetch required XML files and set up subscriptions
	 * @returns {Promise} Resolved when initialisation is complete and the box is ready
	 */
	this.init = function () {
		var requests = _.map(params.xml,function(xmlUrl) {
			return SkyPlusHDHttpRequest.deviceXml(xmlUrl);
		});
		return q.all(requests).then(function(responses) {
			details = responses[0].details;
			_.each(responses,function(response) {
				for (var iService in response.services) {
					if (response.services.hasOwnProperty(iService)) {
						services[iService] = response.services[iService];
					}
				}
			});
			return subscribe().then(channelList.init());
		});
	};

	/**
	 * Send a 'pause' command to the SkyPlusHD box
	 * @returns {Promise} resolved when the command is acknowleged
	 */
	this.pause = function() {
		return soapRequest(
			SkyPlusHDServiceDefinitions.SkyPlay,
			'Pause'
		);
	};

	/**
	 * Send a 'play' command to the SkyPlusHD box
	 * @param {Number} [speed] Playback speed, can be one of [-30,-12,-6,-2,1,2,6,12,30]. Defaults to 1
	 * @returns {Promise} resolved when the command is acknowleged
	 */
	this.play = function(speed) {
		if (_.isUndefined(speed)) {
			speed = 1;
		}
		if ([-30,-12,-6,-2,1,2,6,12,30].indexOf(speed) === -1) {
			console.log("REJECTING");
			return q.reject("Invalid speed");
		}
		return soapRequest(
			SkyPlusHDServiceDefinitions.SkyPlay,
			'Play',
			{Speed: speed}
		);
	};

	/**
	 * Send a 'stop' command to the SkyPlusHD box
	 * @returns {Promise} resolved when the command is acknowleged
	 */
	this.stop = function() {
		return soapRequest(
			SkyPlusHDServiceDefinitions.SkyPlay,
			'Stop'
		);
	};

	this.setChannel = function(channelNumber) {
		channelNumber = parseInt(channelNumber);
		var channel = channelList.findChannel({number:channelNumber});
		if (!channel) {
			return q.reject("Channel not found");
		}
		return soapRequest(
			SkyPlusHDServiceDefinitions.SkyPlay,
			'SetAVTransportURI',
			{CurrentURI: util.format('xsi://%s', channel.id.toString(16))}
		);
	};

	/**
	 * Get details about whats playing on the box
	 * Currently only good for telling the channel.
	 * No good for PVR items
	 * @return {Promise} resolves to channel obj
	 */
	this.whatsOn = function() {
		if (!currentState) {
			return q.reject("No info yet");
		}
		if (!currentState.CurrentTrackURI ) {
			return q.reject("Nothing on");
		}
		if (currentState.CurrentTrackURI.indexOf('xsi://') === 0) {
			var channelId = parseInt(currentState.CurrentTrackURI.match(/\w+$/)[0],16);
			var channel = channelList.findChannel({id:channelId});
			if (channel) {
				return q.resolve(channel);
			} else {
				return q.reject("CHANNEL NOT FOUND");
			}
		} else if (currentState.CurrentTrackURI.indexOf('file://') === 0) {
			return q.reject("PVR");
		} else {
			return q.reject("NO IDEA!");
		}
	};

	/**
	 * Show an image on screen.
	 * @param {String} url - can be on the local network or the wider web
	 * @returns {Promise} - resolves when request is acknowleged
	 *
	 * NOTE:
	 *   - The image MUST be 1280x720 JPG, else it will not display (but no error will be raised)
	 *   - Not all boxes support this - only boxes with modelNumber starting 4F31xx, and software
	 *     version > R010.xxx.xx.xxx - so you should do your own checks before doing this
	 */
	this.showImage = function(url) {
		if (!self.supportsPhotoViewing) {
			return q.reject(new Error("This box does not support photo viewing"));
		} else {
			console.log("SHOWING",url);
			return new SkyPlusHDHttpRequest(util.format(
				"http://%s:%d/photo-viewing/start?uri=%s",
				self.ip,
				49159,
				url
			));
		}
	};

	/**
	 * Remove a displayed image from the screen
	 * @returns {Promise} - resolves when request is acknowleged
	 */
	this.removeImage = function() {
		console.log("REMOVING IMAGE");
		return new SkyPlusHDHttpRequest(util.format(
			"http://%s:%d/photo-viewing/stop",
			self.ip,
			49159
		));
	 };


	 /**
	  * Read all items from the DVR planner
	  * @param  {Number} offset
	  * @return {Promise<Array>} resolves to an array of planner items
	  * @todo Rename this function and fill out the returned items - currently just a name
	  */
	this.readPlanner = function(offset) {
		if (!_.isNumber(offset)) {
			offset = 0;
		}
		return soapRequest(SkyPlusHDServiceDefinitions.SkyBrowse,'Browse',{
			ObjectID: 3,
			BrowseFlag: 'BrowseDirectChildren',
			Filter: '*',
			StartingIndex: offset || 0,
			RequestedCount: 25,
			SortCriteria: []
		}).then(function(response) {
			var progs = _.map(response.payload.result['DIDL-Lite'].item, parsePlannerItem);
			var numberReturned = +response.payload.NumberReturned;
			var totalMatches = +response.payload.TotalMatches;
			if (offset + numberReturned < totalMatches) {
				return self.readPlanner(offset + 25).then(function(moreProgs) {
					return q.resolve(progs.concat(moreProgs));
				});
			} else {
				return q.resolve(progs);
			}
		});
	};

	function soapRequest(service, method, payload) {
		return SkyPlusHDHttpRequest.soapRequest(
			url(services[service].controlURL),
			service,
			method,
			payload
		);
	}

	function parsePlannerItem(data) {
		// Suppress JSHint error W069, "...is better written in dot notation" for this block of code.
		// I don't want to write in dot notation here :-S
		/*jshint -W069 */
		return {
			resource: data['res']['_'],
			id: data['vx:X_recordingID'],
			size: parseInt(data['res']['$']['size']),
			title: data['dc:title'],
			description: data['dc:description'],
			channel: {
				num: parseInt(data['upnp:channelNr']),
				name: data['upnp:channelName'],
				id: data['upnp:channelID'] ? data['upnp:channelID']['_'] : undefined, // Could be a download
			},
			lastPlaybackPosition: parseInt(data['vx:X_lastPlaybackPosition']),
			isViewed: (data['vx:X_isViewed']==='1'),
			isPlaying: (data['vx:X_isPlaying']==='1'),
			season: (data['vx:X_seasonNumber']!=='0') ? parseInt(data['vx:X_seasonNumber']) : undefined,
			episode: (data['upnp:episodeNumber']!=='0') ? parseInt(data['upnp:episodeNumber']) : undefined,
			scheduled: {
				start: data['upnp:scheduledStartTime'],
				end: data['upnp:scheduledEndTime'],
				duration: data['upnp:scheduledDuration']
			},
			recorded: {
				start: data['upnp:recordedStartDateTime'],
				duration: data['upnp:recordedDuration']
			},
			booking: {
				time: data['vx:X_bookingTime'],
				type: data['vx:X_bookingType'],
				active: data['vx:X_bookingActive'],
				keep: data['vx:X_bookingKeep'],
			},
			flags: {
				isHd: (data['vx:X_flags']['$'].hd === '1'),
				hasForeignSubtitles: (data['vx:X_flags']['$'].hasForeignSubtitles === '1'),
				hasAudioDesc: (data['vx:X_flags']['$'].hasAudioDesc === '1'),
				widescreen: (data['vx:X_flags']['$'].widescreen === '1'),
				isLinked: (data['vx:X_flags']['$'].isLinked === '1'),
				currentSeries: (data['vx:X_flags']['$'].currentSeries === '1'),
				is3D: (data['vx:X_flags']['$'].is3D === '1'),
				isAdult: (data['vx:X_flags']['$'].isAdult === '1'),
				isFirstRun: (data['vx:X_flags']['$'].firstRun === '1')
			 }
		};
		/*jshint +W069 */
	}

};

module.exports = SkyPlusHDBox;
