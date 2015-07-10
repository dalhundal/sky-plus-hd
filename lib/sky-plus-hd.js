"use strict";

var SkyPlusHDFinder = require('./sky-plus-hd_finder');

/**
 * Find a SkyPlusHDBox on the local network
 * @see SkyPlusHDFinder.find
 */
module.exports.findBox = function(ipAddress) {
	var finder = new SkyPlusHDFinder();
	return finder.findBox(ipAddress);
};