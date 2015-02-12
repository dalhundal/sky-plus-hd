"use strict";

var q = require('q');
var util = require('util');
var xml = require('xml');
var _ = require('underscore');

var SkyPlusHDChannelList = require('./sky-plus-hd_channel-list');
var SkyPlusHDEventListener = require('./sky-plus-hd_event-listener');
var SkyPlusHDHttpRequest = require('./sky-plus-hd_http-request');
var SkyPlusHDServiceDefinitions = require('./sky-plus-hd_service-definitions');

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
	 * Remove an image from screen
	 */

	function generateSoapRequestBody(service,method,payload) {
		var transformedPayload = [];
		transformedPayload.push({'_attr':{
			'xmlns:u': service
		}});
		payload = _.defaults(payload||{},{
			InstanceID: 0
		});
		_.each(payload,function(val,key) {
			var obj =  {};
			obj[key]=val;
			transformedPayload.push(obj);
		});
		//
		var sBodyContent = {};
		sBodyContent['u:'+method] = transformedPayload;
		//
		var jsonBody = [{
			's:Envelope': [
				{'_attr': {
					's:encodingStyle':'http://schemas.xmlsoap.org/soap/encoding/',
					'xmlns:s':'http://schemas.xmlsoap.org/soap/envelope/'
				}},
				{'s:Body': [sBodyContent]}
			]}
		];
		return '<?xml version="1.0" encoding="utf-8"?>'+xml(jsonBody);
	}

	function soapRequest(service, method, payload) {
		var deferred = q.defer();
		//
		return SkyPlusHDHttpRequest.device({
			url: url(services[service].controlURL),
			method: 'POST',
			headers: {
				'SOAPACTION': '"'+service + '#'+method+'"',
				'Content-Type': 'text/xml; charset="utf-8"'
			},
			body: generateSoapRequestBody(service,method,payload)
		});
	}

};

module.exports = SkyPlusHDBox;