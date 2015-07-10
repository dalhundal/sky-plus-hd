"use strict";

var Promise = require('bluebird');
var request = require('request');
var util = require('util');
var xml = require('xml');
var _ = require('underscore');

var SkyPlusHDBoxModels = require('./sky-plus-hd_box-models');
var SkyPlusHDXmlParser = require('./sky-plus-hd_xml-parser');

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
	return new Promise(function(resolve, reject) {
		var _request = usingRequest || request;
		_request(params,function(err, response, body) {
			if (err) {
				reject(err);
			} else {
				resolve({
					body: body,
					headers: response.headers
				});
			}
		});
	});
};

/**
 * SkyPlusHDHttpRequest.getJson - Wrapper for making HTTP requests and parsing Json responses
 * @param {String} params - Params as passed to REQUEST lib
 * @returns {Promise.<Object>} Resolves to an object containing the keys 'body' and 'headers'
 */
SkyPlusHDHttpRequest.getJson = function(params, usingRequest) {
	return new SkyPlusHDHttpRequest(params, usingRequest).then(function(response) {
		try {
			response.body = JSON.parse(response.body);
			return Promise.resolve(response);
		} catch (e) {
			return Promise.reject(new Error("Failed to parse JSON string"));
		}
	});
};

/**
 * SkyPlusHDHttpRequest.device - Wrapper for making HTTP requests to a SkyPlusHD box
 * @param {String} params - Params as passed to REQUEST lib
 * @param {Boolean} [parseXml=true] - Should the response body be processed with the XML parser?
 * @returns {Promise.<Object>} Resolves to an object containing the keys 'body' and 'headers'
 */
SkyPlusHDHttpRequest.device = function(params) {
	return new SkyPlusHDHttpRequest(params, _SkyPlusHDHttpRequestDevice).then(function(response) {
		return new SkyPlusHDXmlParser(response.body).then(function(parsedBody) {
			return Promise.resolve({
				body: parsedBody,
				headers: response.headers
			});
		});
	});
};

/**
 * SkyPlusHDHttpRequest.deviceXml Fetch and parse a device XML file
 * @private
 * @param {String} params - URL of the device XML file
 * @returns {Promise.<Object>} Object with the keys 'details' and 'services'
 */
SkyPlusHDHttpRequest.deviceXml = function(params) {
	return SkyPlusHDHttpRequest.device(params).then(function(response) {
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
		return Promise.resolve({
			details: details,
			services: services
		});
	});
};

SkyPlusHDHttpRequest.soapRequest = function(serviceUrl, service, method, payload) {
	return SkyPlusHDHttpRequest.device({
		url: serviceUrl,
		method: 'POST',
		headers: {
			'SOAPACTION': '"'+service + '#'+method+'"',
			'Content-Type': 'text/xml; charset="utf-8"'
		},
		body: SkyPlusHDHttpRequest.soapRequest.generateSoapRequestBody(service, method, payload)
	}).then(function(response) {
		try {
			var body = response.body['s:Envelope']['s:Body'];
			if (body['s:Fault']) {
				util.format("%s - %s",body['s:Fault']['detail'][body['s:Fault']['faultstring']]['errorDescription'], body['s:Fault']['detail'][body['s:Fault']['faultstring']]['errorCode']);
				return Promise.reject(body['s:Fault']['faultstring'])
			}
			var methodResponse = body[util.format('u:%sResponse',method)];
			response.payload = {};
			for (var i in methodResponse) {
				if (i!=='$' && i!=='Result') {
					response.payload[i] = methodResponse[i];
				}
			}
			if (methodResponse && methodResponse.Result) {
				return new SkyPlusHDXmlParser(methodResponse.Result).then(function(result) {
					response.payload.result = result;
					return Promise.resolve(response);
				});
			} else {
				return Promise.resolve(response);
			}
		} catch (e) {
			console.log(e);
			return Promise.reject("Failed to parse response payload");
		}
	});
};

SkyPlusHDHttpRequest.soapRequest.generateSoapRequestBody = function(service,method,payload) {
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
	};

module.exports = SkyPlusHDHttpRequest;
