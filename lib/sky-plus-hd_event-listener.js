"use strict";

var eventEmitter = require('events').EventEmitter;
var freeport = require('freeport');
var http = require('http');
var ip = require('ip');
var Promise = require('bluebird');
var util = require('util');

var SkyPlusHDXmlParser = require('./sky-plus-hd_xml-parser');
var SkyPlusHDHttpRequest = require('./sky-plus-hd_http-request');
var SkyPlusHDState = require('./sky-plus-hd_state');

/**
 * SkyPlusHDEventListener - subscribes to notifications from a sky box and emits events when changes are detected
 * @private
 * @param {String} eventSubscriptionUrl - a service's eventSubURL to subscribe to
 * @constructor
 */
var SkyPlusHDEventListener = function(eventSubscriptionUrl) {

	eventEmitter.call(this);
	var self = this;
	var listeningSocket;
	var listeningPort;
	var renewSubscriptionTimer;
	var sid;

	/**
	 * Open a TCP socket to receive notifications from a SkyPlusHD box.
	 * @returns {Promise} - resolved when the socket is listening
	 */
	function listenForNotifications() {
		return new Promise(function(resolve, reject) {
			listeningSocket = http.createServer(function(req, res) {
				if (sid && req.headers.sid !== sid) {
					res.writeHead(404,{'Content-Type':'text/plain'});
					res.end();
					return;
				}
				var chunks = "";
				req.on('data',function(chunk) { chunks+=chunk; });
				req.on('end',function() {
					new SkyPlusHDXmlParser(chunks).then(function(result) {
						new SkyPlusHDXmlParser(result['e:propertyset']['e:property'].LastChange).then(function(results) {
							var ev = new SkyPlusHDState(results.Event.InstanceID);
							self.emit('notification',ev);
						});
					});
				});
				res.writeHead(200,{'Content-Type':'text/plain'});
				res.end('OK');
			}).listen(listeningPort,function() {
				resolve();
			});
		});
	}

	/**
	 * Submits a subscription request to a SkyPlusHD box - if a previous subscription is still valid, renews that subscription
	 * @returns {Promise} resolved when subscription request is acknowleged
	 */
	function subscribe() {
		return new Promise(function(resolve, reject) {
			SkyPlusHDHttpRequest.device({
				url: eventSubscriptionUrl,
				method: 'SUBSCRIBE',
				headers: (sid) ? {
					sid: sid
				} : {
					callback: util.format("<http://%s:%d>",ip.address(),listeningPort),
					nt: 'upnp:event'
				}
			}).then(function(response) {
				sid = response.headers.sid;
				resolve(sid);
				// Renew the subscription every 4 minutes...
				renewSubscriptionTimer = setTimeout(subscribe, 1000*60*4);
			}).catch(function(err) {
				reject(err);
			});
		});
	}

	this.start = function() {
		return new Promise(function(resolve, reject) {
			freeport(function(err, port) {
				if (err) {
					console.log("FREE PORT FAILED");
					reject(err);
				} else {
					listeningPort = port;
					listenForNotifications().then(function() {
						subscribe().then(function() {
							resolve();
						});
					}).catch(function(err) {
						console.log("SHIT",err);
					});
				}
			});
		});
	};
};
util.inherits(SkyPlusHDEventListener, eventEmitter);

module.exports = SkyPlusHDEventListener;