"use strict";

var q = require('q');
var xml2js = require('xml2js');
var _ = require('underscore');

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
		}
		_.each(o,function(v,k) {
			if (!_.isObject(v) && !_.isArray(v)) {
				ret[k] = v;
			} else if (_.isArray(v)) {
				if (v.length===1) {
					ret[k] = cleanupXml(v[0]);
				} else {
					ret[k] = cleanupXml(v);
				}
			} else if (_.isObject(v)) {
				ret[k] = cleanupXml(v);
			}
		});
		return ret;
	}
	var deferred = q.defer();
	xml2js.parseString(xml,function(err,results) {
		if (err) {
			deferred.reject(err);
		} else {
			deferred.resolve(cleanupXml(results));
		}
	});
	return deferred.promise;
};

module.exports = SkyPlusHDXmlParser;