"use strict";

var q = require('q');
var request = require('request');
var _ = require('underscore');

var SkyPlusHDBoxModels = require('./sky-plus-hd_box-models');
var SkyPlusHDXmlParser = require('./sky-plus-hd_xml-parser');

q.longStackSupport = true;

/**
 * REQUEST with defaults appropriate to SkyPlusHD boxes set
 * @private
 */
var _SkyPlusHDHttpRequestDevice = request.defaults({
	encoding: 'utf8',
	headers: {
		'User-Agent': 'SKY_skyplus'
	},
	timeout: 5000
});

/**
 * SkyPlusHDHttpRequest - Wrapper for making HTTP requests
 * @param {String} params - Params as passed to REQUEST lib
 * @returns {Promise.<Object>} Resolves to an object containing the keys 'body' and 'headers'
 */
var SkyPlusHDHttpRequest = function(params, usingRequest) {
	var deferred = q.defer();
	var _request = usingRequest || request;
	_request(params,function(err, response, body) {
		if (err) {
			deferred.reject(err);
		} else {
			deferred.resolve({
				body: body,
				headers: response.headers
			});
		}
	});
	return deferred.promise;
};

/**
 * SkyPlusHDHttpRequest.getJson - Wrapper for making HTTP requests and parsing Json responses
 * @param {String} params - Params as passed to REQUEST lib
 * @returns {Promise.<Object>} Resolves to an object containing the keys 'body' and 'headers'
 */
SkyPlusHDHttpRequest.getJson = function(params, usingRequest) {
	var deferred = q.defer();
	new SkyPlusHDHttpRequest(params, usingRequest).then(function(response) {
		try {
			response.body = JSON.parse(response.body);
			deferred.resolve(response);
		} catch (e) {
			deferred.reject(e);
		}
	}).fail(deferred.reject);
	return deferred.promise;
};

/**
 * SkyPlusHDHttpRequest.device - Wrapper for making HTTP requests to a SkyPlusHD box
 * @param {String} params - Params as passed to REQUEST lib
 * @param {Boolean} [parseXml=true] - Should the response body be processed with the XML parser?
 * @returns {Promise.<Object>} Resolves to an object containing the keys 'body' and 'headers'
 */
SkyPlusHDHttpRequest.device = function(params) {
	var deferred = q.defer();
	new SkyPlusHDHttpRequest(params, _SkyPlusHDHttpRequestDevice).then(function(response) {
		new SkyPlusHDXmlParser(response.body).then(function(parsedBody) {
			deferred.resolve({
				body: parsedBody,
				headers: response.headers
			});	
		}).catch(function(err) {
			deferred.reject(err);
		});
	}).fail(deferred.reject);
	return deferred.promise;
};

/**
 * SkyPlusHDHttpRequest.deviceXml Fetch and parse a device XML file
 * @private
 * @param {String} params - URL of the device XML file
 * @returns {Promise.<Object>} Object with the keys 'details' and 'services'
 */
SkyPlusHDHttpRequest.deviceXml = function(params) {
	var deferred = q.defer();
	SkyPlusHDHttpRequest.device(params).then(function(response) {
		/* Look up the device model and capacity based on modelDescription */
		var boxModel = SkyPlusHDBoxModels.match(response.body.root.device.modelDescription);
		var details = {
			model: boxModel.name,
			capacity: boxModel.capacity,
			modelDescription: response.body.root.device.modelDescription,
			modelName: response.body.root.device.modelName,
			software: response.body.root.device.modelNumber,
			serial: response.body.root.device.friendlyName,
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
	}).fail(deferred.reject);
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
			}
			deferred.resolve({
				body: jsonData,
				headers: response.headers
			});
		}
	});
	return deferred.promise;
};

module.exports = SkyPlusHDHttpRequest;