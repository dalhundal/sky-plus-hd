var _ = require('underscore');
var _s = require('underscore.string');
var q = require('q');
var request = require('request');
var ssdp = require('node-ssdp');

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
				deferred.resolve(box);
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
 * @param {String} url - HTTP url to retreive
 * @returns {Promise.<Object>} Resolves to an object containing the keys 'body' and 'headers'
 */
var SkyPlusHDHttpRequest = module.exports.SkyPlusHDHttpRequest = function(params) {
	var deferred = q.defer();
	_SkyPlusHDHttpRequest(params,function(err, response, body) {
		if (err) {
			deferred.reject(err);
		} else {
			deferred.resolve({
				body: body,
				headers: response.headers
			});
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

	this.port = params.port;

}