"use strict";

var _ = require('underscore');
var _s = require('underscore.string');
var eventEmitter = require('events').EventEmitter;
var freeport = require('freeport');
var http = require('http');
var ip = require('ip');
var jf = require('jsonfile');
var q = require('q');
var request = require('request');
var ssdp = require('node-ssdp');
var util = require('util');
var xml2js = require('xml2js');

q.logStackSupport = true;

/**
 * ServiceDefinitions - list of URN's used by SkyPlusHD boxes
 * @private
 */
var SkyPlusHDServiceDefinitions = {
	SkyServe: "urn:schemas-nds-com:device:SkyServe:2",
	SkyBook: "urn:schemas-nds-com:service:SkyBook:2",
	SkyBrowse: "urn:schemas-nds-com:service:SkyBrowse:2",
	SkyControl: "urn:schemas-nds-com:device:SkyControl:2",
	SkyPlay: "urn:schemas-nds-com:service:SkyPlay:2",
	SkyCM: "urn:schemas-nds-com:service:SkyCM:2",
	SkyRC: "urn:schemas-nds-com:service:SkyRC:2"
};

var SkyPlusHDBoxModels = {
	/* Object key is a regex that model strings will be tested against
		Order of the patterns here is very important */
	patterns: {
		'4E30..': {name:'DSI8215', capacity: '300GB'},
		'9F30..': {name:'TDS850NB', capacity: '300GB'},
		'9730..': {name:'HDSKY 300GB', capacity: '300GB'},
		'973B..': {name:'HDSKY 500GB', capacity: '500GB'},
		'4F30..': {name:'DRX780', capacity: '300GB'},
		'4F3133': {name:'DRX890WL', capacity: '500GB'},
		'4F313.': {name:'DRX890W', capacity: '500GB'},
		'4F315[56]': {name:'DRX895', capacity: '2TB'},
		'4F315.': {name:'DRX895', capacity: '1.5TB'},
		'4F317.': {name:'DRX895W', capacity: '2TB'},
		'4F31E8': {name:'DRX895WL', capacity: '2TB'},
		'4F31..': {name:'DRX890', capacity: '500GB'},
	},
	match: function(model) {
		var match = {name: 'UNKNOWN', capacity: 'UNKNOWN'};
		for (var i in this.patterns) {
			if (RegExp('^'+i+'$').test(model.toUpperCase())) {
				match = this.patterns[i];
				break;
			}
		};
		return match;
	}
}

/**
 * SkyPlusHDFinder
 * @class
 */
var SkyPlusHDFinder = module.exports.SkyPlusHDFinder = function() {

	var self = this;
	var _timeout = 5000;

	/**
	 * Find a SkyPlusHD box on the local network.
	 * @param {String} [ipAddress] - search for SkyPlusHD box with the specified IP address.
	 * @returns {Promise.<SkyPlusHDBox, Error>} - Returns a promise which resolves to a SkyPlusHDBox if one is found
	 */
	this.findBox = function SkyPlusHD_findBox(ipAddress) {
		var deferred = q.defer();
		/* Search for SkyRC service THEN search for SkyBrowse with the same IP to ensure both results
			are from the same box */
		discoverService(SkyPlusHDServiceDefinitions.SkyRC, ipAddress).then(function(skyRC) {
			discoverService(SkyPlusHDServiceDefinitions.SkyBrowse, skyRC.rInfo.address).then(function(skyBrowse) {
				var box = new SkyPlusHDBox({
					ip: skyRC.rInfo.address,
					port: skyRC.rInfo.port,
					xml: [skyRC.headers.LOCATION, skyBrowse.headers.LOCATION]
				});
				box.init().then(function() {
					deferred.resolve(box)
				}).fail(function() {
					deferred.reject
				});
			}).fail(function(err) {
				deferred.reject(err);
			});
		}).fail(function(err) {
			deferred.reject(err);
		});
		return deferred.promise;
	};

	/**
	 * Search for ssdp services
	 * @private
	 * @param {String} serviceUrn - ssdp URN to search for
	 * @param {String} [ipAddress] - service IP must match specified IP
	 * @returns {Promise.<Object, Error>} - Promise which resolves to an Object containing IP and service msg
	 */
	function discoverService(serviceUrn, ipAddress) {
		var deferred = q.defer();
		var ssdpClient = new ssdp.Client();
		/* Set a timer to reject the promise after a while, to act as a timeout */
		var timeoutTimer = setTimeout(function() {
			ssdpClient._stop();
			deferred.reject(new Error('Timeout searching for service '+serviceUrn));
		},_timeout);
		ssdpClient.on('response', function(headers, statusCode, rInfo) {
			/* If ipAddress param is present, check if the response matches */
			if (!ipAddress || ip.isEqual(rInfo.address,ipAddress)) {
				clearTimeout(timeoutTimer);
				ssdpClient._stop();
				deferred.resolve({
					headers: headers,
					rInfo: rInfo
				});
			}
		});
		ssdpClient.search(serviceUrn);
		return deferred.promise;
	};
}

/**
 * Find a SkyPlusHDBox on the local network
 * @see SkyPlusHDFinder.find
 */
module.exports.findBox = function(ipAddress) {
	var finder = new SkyPlusHDFinder();
	return finder.findBox(ipAddress);
}

/**
 * REQUEST with defaults appropriate to SkyPlusHD boxes set
 * @private
 */
var _SkyPlusHDHttpRequest = request.defaults({
	encoding: 'utf8',
	headers: {
		'User-Agent': 'SKY_skyplus'
	},
	timeout: 5000
});

/**
 * SkyPlusHDHttpRequest - Wrapper for making HTTP requests to a SkyPlusHD box
 * @param {String} params - Params as passed to REQUEST lib
 * @param {Boolean} [parseXml=true] - Should the response body be processed with the XML parser?
 * @returns {Promise.<Object>} Resolves to an object containing the keys 'body' and 'headers'
 */
var SkyPlusHDHttpRequest = module.exports.SkyPlusHDHttpRequest = function(params, parseXml) {
	var deferred = q.defer();
	parseXml = (parseXml || _.isUndefined(parseXml)) ? true : false;
	_SkyPlusHDHttpRequest(params,function(err, response, body) {
		if (err) {
			deferred.reject(err);
		} else {
			if (parseXml) {
				SkyPlusHDXmlParser(body).then(function(parsedBody) {
					deferred.resolve({
						body: parsedBody,
						headers: response.headers
					});	
				}).catch(function(err) {
					deferred.reject(err);
				});
			} else {
				deferred.resolve({
					body: body,
					headers: response.headers
				});
			}
		};
	});
	return deferred.promise;
};

/**
 * Fetch and parse a device XML file
 * @private
 * @param {String} url - URL of the device XML file
 * @returns {Promise.<Object>} Object with the keys 'details' and 'services'
 */
SkyPlusHDHttpRequest.requestDeviceXml = function (url) {
	var deferred = q.defer();
	SkyPlusHDHttpRequest(url).then(function(response) {
		/* Look up the device model and capacity based on modelDescription */
		var boxModel = SkyPlusHDBoxModels.match(response.body.root.device.modelDescription);
		var details = {
			model: boxModel.name,
			capacity: boxModel.capacity,
			modelDescription: response.body.root.device.modelDescription,
			modelName: response.body.root.device.modelName,
			software: response.body.root.device.modelNumber,
			friendlyName: response.body.root.device.friendlyName,
			manufacturer: response.body.root.device.manufacturer
		};
		var services = {};
		_.each(response.body.root.device.serviceList.service,function(serviceNode) {
			services[serviceNode.serviceType] = {
				serviceType: serviceNode.serviceType,
				serviceId: serviceNode.serviceId,
				SCPDURL: serviceNode.SCPDURL,
				controlURL: serviceNode.controlURL,
				eventSubURL: serviceNode.eventSubURL
			};
		});
		deferred.resolve({
			details: details,
			services: services
		});
	}).fail(function(err) {
		deferred.reject(err)
	});
	return deferred.promise;
};

/**
 *
 */
SkyPlusHDHttpRequest.getJson = function(url) {
	var deferred = q.defer();
	request(url,function(err, response, body) {
		if (err) {
			deferred.reject(err);
		} else {
			var jsonData;
			try {
				jsonData = JSON.parse(body);
			} catch (e) {
				deferred.reject(e);
				return;
			};
			deferred.resolve({
				body: jsonData,
				headers: response.headers
			});
		};
	});
	return deferred.promise;
};

/**
 * Parse XML format returned by SkyPlusHD boxes into a JS object
 * @private
 * @param {String} xml - String of XML as returned from a SkyPlusHD box
 * @returns {Promise.<Object>} - resolves to a JS object representation of the xml
 */
var SkyPlusHDXmlParser = function(xml) {
	function cleanupXml(o) {
		var ret;
		if (!_.isObject(o) && _.isArray(o)) {
			ret = [];
		} else if (_.isObject(o)) {
			ret = {};
		} else {
			return o;
		};
		_.each(o,function(v,k) {
			if (!_.isObject(v) && !_.isArray(v)) {
				ret[k] = v;
			} else if (_.isArray(v)) {
				if (v.length==1) {
					ret[k] = cleanupXml(v[0]);
				} else {
					ret[k] = cleanupXml(v);
				};
			} else if (_.isObject(v)) {
				ret[k] = cleanupXml(v);
			};
		});
		return ret;
	};
	var deferred = q.defer();
	xml2js.parseString(xml,function(err,results) {
		if (err) {
			deferred.reject(err);
		} else {
			deferred.resolve(cleanupXml(results));
		};
	});
	return deferred.promise;
};

/**
 * SkyPlusHDBox - representation of a single physical SkyPlusHD box
 * @class
 */
var SkyPlusHDBox = module.exports.SkyPlusHDBox = function(params) {

	var self = this;
	var details = {};
	var services = {};
	eventEmitter.call(this);

	Object.defineProperty(self, "ip", {
		get: function() {
			return params.ip
		}
	});

	Object.defineProperty(self, "port", {
		get: function() {
			/* Not sure what the other port is for - always seems to actually be 49153 */
			return 49153;
			return params.port
		}
	});

	Object.defineProperty(self,"model",{
		get: function() {
			return details.model
		}
	});

	Object.defineProperty(self,"capacity",{
		get: function() {
			return details.capacity
		}
	});

	Object.defineProperty(self,"software",{
		get: function() {
			return details.software
		}
	});

	/**
	 * Subscribe to event notifications from the device
	 * @private
	 * @returns {Promise} resolves when we are ready to receive notifications
	 */
	function subscribe() {
		var deferred = q.defer();
		var listener = new SkyPlusHDEventListener(
			util.format(
				"http://%s:%d%s",
				self.ip,
				self.port,
				services[SkyPlusHDServiceDefinitions.SkyPlay].eventSubURL
			)
		);
		listener.on('notification',function(ev) {
			console.log(self.ip,"STATE",ev);
		});
		listener.start().then(function() {
			deferred.resolve();
		}).fail(function(err) {
			deferred.reject();
		})
		return deferred.promise;
	};

	/**
	 * Initialise the box: fetch required XML files and set up subscriptions
	 * @returns {Promise} Resolved when initialisation is complete and the box is ready
	 */
	this.init = function () {
		var deferred = q.defer();
		var requests = _.map(params.xml,function(xmlUrl) {
			return SkyPlusHDHttpRequest.requestDeviceXml(xmlUrl);
		});
		q.all(requests).then(function(responses) {
			details = responses[0].details;
			_.each(responses,function(response) {
				for (var iService in response.services) {
					services[iService] = response.services[iService];
				};
			});
			//
			subscribe().then(function() {
				deferred.resolve()
			}).catch(function(err) {
				deferred.reject(err)
			});
		}).catch(function(err) {
			deferred.reject(err);
		});
		return deferred.promise;
	};

};

/**
 * SkyPLusHDEventListener - subscribes to notifications from a sky box and emits events when changes are detected
 * @private
 * @param {String} eventSubscriptionUrl - a service's eventSubURL to subscribe to
 * @constructor
 */
var SkyPlusHDEventListener = function(eventSubscriptionUrl) {

	var self = this;
	var listeningSocket;
	var listeningPort;
	var sid;

	/**
	 * Open a TCP socket to receive notifications from a SkyPlusHD box.
	 * @returns {Promise} - resolved when the socket is listening
	 */
	function listenForNotifications() {
		var deferred = q.defer();
		listeningSocket = http.createServer(function(req, res) {
			if (sid && req.headers.sid != sid) {
				res.writeHead(404,{'Content-Type':'text/plain'});
				res.end();
				return;
			};
			var chunks = "";
			req.on('data',function(chunk) { chunks+=chunk; });
			req.on('end',function() {
				SkyPlusHDXmlParser(chunks).then(function(result) {
					SkyPlusHDXmlParser(result['e:propertyset']['e:property'].LastChange).then(function(results) {
						var ev = {
							TransportState: results.Event.InstanceID.TransportState['$'].val,
							CurrentTrackURI: results.Event.InstanceID.CurrentTrackURI['$'].val,
							TransportPlaySpeed: results.Event.InstanceID.TransportPlaySpeed['$'].val,
							AVTransportURI: results.Event.InstanceID.AVTransportURI['$'].val,
							TransportStatus: results.Event.InstanceID.TransportStatus['$'].val,
						}
						//console.log("NOTIFICATION",ev);
						self.emit('notification',ev);
					});
				});
			});
			res.writeHead(200,{'Content-Type':'text/plain'});
			res.end('OK');
		}).listen(listeningPort,function() {
			deferred.resolve();
		});
		return deferred.promise;
	};

	/**
	 * Submits a subscription request to a SkyPlusHD box - if a previous subscription is still valid, renews that subscription
	 * @returns {Promise} resolved when subscription request is acknowleged
	 */
	function subscribe() {
		var deferred = q.defer();
		SkyPlusHDHttpRequest({
			url: eventSubscriptionUrl,
			method: 'SUBSCRIBE',
			headers: (sid) ? {
				sid: sid
			} : {
				callback: util.format("<http://%s:%d>",ip.address(),listeningPort),
				nt: 'upnp:event'
			}
		}).then(function(response) {
			sid = response.headers.sid
			deferred.resolve(sid);
		}).fail(function(err) {
			deferred.reject(err);
		});
		return deferred.promise;
	}

	function processNotification(notification) {
		console.log("NOTIFICATION",notification);
	};

	this.start = function() {
		var deferred = q.defer();
		freeport(function(err, port) {
			if (err) {
				console.log("FREE PORT FAILED");
				deferre.reject(err);
			} else {
				listeningPort = port;
				listenForNotifications().then(function() {
					subscribe().then(function() {
						deferred.resolve();
					});
				});
			}
		});
		return deferred.promise;
	};
}
util.inherits(SkyPlusHDEventListener, eventEmitter);


/**
 * SkyPlusHDChannelList
 */
var SkyPlusHDChannelList = module.exports.SkyPlusHDChannelList = function(regionCodeOrName) {

	var self = this;
	this.region = undefined;
	this.channels = [];

	if (!regionCodeOrName) {
		regionCodeOrName = 'london';
	};

	function findRegion(regionCodeOrName) {
		var deferred = q.defer();
		var isCode = false;
		if (regionCodeOrName.match(/^\d{4}-\d{1,2}$/)) {
			isCode = true;
		};
		regionCodeOrName = regionCodeOrName.toLowerCase();
		jf.readFile(__dirname + '/sky-regions.json',function(err, obj) {
			if (err) {
				deferred.reject(err);
			} else {
				for (var i in obj) {
					if (isCode && obj[i].hd == regionCodeOrName) {
						deferred.resolve(obj[i]);
						return;
					} else if (i == regionCodeOrName) {
						deferred.resolve(obj[i]);
						return;
					};
				};
				deferred.reject("No match found");
			};
		});
		return deferred.promise;
	};

	function fetchChannelList(regionCode) {
		var deferred = q.defer();
		var url = util.format("http://tv.sky.com/channel/index/%s",regionCode);
		SkyPlusHDHttpRequest.getJson(url).then(function(response) {
			var channels = _.map(response.body.init.channels,function(channelData) {
				return {
					name: channelData.t,
					nameLong: channelData.lcn || channelData.t,
					number: channelData.c[1],
					id: channelData.c[0]
				};
			});
			deferred.resolve(channels)
		}).fail(function(err) {
			console.log(err);
		});
		return deferred.promise;
	};

	this.init = function() {
		var deferred = q.defer();
		findRegion(regionCodeOrName).then(function(region) {
			self.region = region;
			fetchChannelList(region.hd).then(function(channels) {
				self.channels = channels;
				deferred.resolve();
			}).fail(deferred.reject);
		}).fail(deferred.reject).done();
		return deferred.promise;
	};

	this.findChannel = function(properties) {
		return _.findWhere(self.channels,properties);
	};
}