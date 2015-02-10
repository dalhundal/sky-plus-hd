"use strict";

var jsonfile = require('jsonfile');
var q = require('q');
var util = require('util');
var _ = require('underscore');

var SkyPlusHDHttpRequest = require('./sky-plus-hd_http-request');

q.longStackSupport = true;

/**
 * SkyPlusHDChannelList
 */
var SkyPlusHDChannelList = function(regionCodeOrName) {

	var self = this;
	this.region = undefined;
	this.channels = [];

	/**
	 * Default to the London region if no code or name specified.
	 * see sky-regions.json for a list of regions and codes
	 */
	if (!regionCodeOrName) {
		regionCodeOrName = 'london';
	}

	/**
	 * Lookup a region from sky-regions.json
	 * @param {String} regionCodeOrName - either a code or short region name
	 * @returns {Promise.<Object>} resolves to an object containing region details, if found
	 */
	function findRegion(regionCodeOrName) {
		var deferred = q.defer();
		var isCode = false;
		if (regionCodeOrName.match(/^\d{4}-\d{1,2}$/)) {
			isCode = true;
		}
		regionCodeOrName = regionCodeOrName.toLowerCase();
		jsonfile.readFile(__dirname + '/data/sky-regions.json',function(err, obj) {
			if (err) {
				deferred.reject(err);
			} else {
				for (var i in obj) {
					if (isCode && obj[i].hd === regionCodeOrName) {
						deferred.resolve(obj[i]);
						return;
					} else if (i === regionCodeOrName) {
						deferred.resolve(obj[i]);
						return;
					}
				}
				deferred.reject("No match found");
			}
		});
		return deferred.promise;
	}

	/**
	 * Downloads channel list from Sky website
	 * @param {String} regionCode
	 * @returns {Promise.<Array>} resolves to an array of channel info objects
	 */
	function fetchChannelList(regionCode) {
		var url = util.format("http://tv.sky.com/channel/index/%s",regionCode);
		return SkyPlusHDHttpRequest.getJson(url).then(function(response) {
			var channels = _.map(response.body.init.channels,function(channelData) {
				return {
					name: channelData.t,
					nameLong: channelData.lcn || channelData.t,
					number: channelData.c[1],
					id: channelData.c[0]
				};
			});
			return q.resolve(channels);
		});
	}

	/**
	 * Lookup region and fetch channel list
	 * @returns {Promise}
	 */
	this.init = function() {
		return findRegion(regionCodeOrName).then(function(region) {
			self.region = region;
			return fetchChannelList(region.hd).then(function(channels) {
				self.channels = channels;
				return q.resolve();
			});
		});
	};

	/**
	 * Find channel matching given properties
	 * @param {Object} properties - properties to match on
	 * @return {Object} matching channel, if found
	 */
	this.findChannel = function(properties) {
		return _.findWhere(self.channels,properties);
	};
};

module.exports = SkyPlusHDChannelList;