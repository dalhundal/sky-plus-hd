"use strict";

var _ = require('underscore');
var _s = require('underscore.string');
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
	var _timeout = 2500;

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
			if (!ipAddress || rInfo.address == ipAddress) {
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

	Object.defineProperty(self, "ip", {
		get: function() {
			return params.ip
		}
	});

	Object.defineProperty(self, "port", {
		get: function() {
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
	 * @todo flesh out this dummy function
	 */
	function subscribe(url) {
		var deferred = q.defer();
		deferred.resolve();
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