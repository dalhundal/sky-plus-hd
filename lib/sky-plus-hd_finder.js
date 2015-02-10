"use strict";

var ip = require('ip');
var q = require('q');
var ssdp = require('node-ssdp');

var SkyPlusHDBox = require('./sky-plus-hd_box');
var SkyPlusHDServiceDefinitions = require('./sky-plus-hd_service-definitions');

q.longStackSupport = true;

/**
 * SkyPlusHDFinder
 * @class
 */
var SkyPlusHDFinder = function() {

	var self = this;
	var _timeout = 5000;

	/**
	 * Find a SkyPlusHD box on the local network.
	 * @param {String} [ipAddress] - search for SkyPlusHD box with the specified IP address.
	 * @returns {Promise.<SkyPlusHDBox, Error>} - Returns a promise which resolves to a SkyPlusHDBox if one is found
	 */
	this.findBox = function SkyPlusHD_findBox(ipAddress) {
		/* Search for SkyRC service THEN search for SkyBrowse with the same IP to ensure both results
			are from the same box */
		return discoverService(SkyPlusHDServiceDefinitions.SkyRC, ipAddress).then(function(skyRC) {
			return discoverService(SkyPlusHDServiceDefinitions.SkyBrowse, skyRC.rInfo.address).then(function(skyBrowse) {
				var box = new SkyPlusHDBox({
					ip: skyRC.rInfo.address,
					port: skyRC.rInfo.port,
					xml: [skyRC.headers.LOCATION, skyBrowse.headers.LOCATION]
				});
				return box.init().then(function() {
					return q.resolve(box);
				}).fail(function() {
					return q.reject();
				});
			});
		});
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
	}
};

module.exports = SkyPlusHDFinder;