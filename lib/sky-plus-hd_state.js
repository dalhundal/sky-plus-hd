"use strict";

var SkyPlusHDState = function(rawEvent) {

	var self = this;

	var _uri = undefined;
	var _playSpeed = undefined;

	Object.defineProperty(this,'playSpeed',{
		get: function() {
			return _playSpeed;
		},
		set: function(val) {
			_playSpeed = +val;
		},
		enumerable: true
	});

	Object.defineProperty(this,'uri',{
		get: function() {
			return _uri;
		},
		set: function(val) {
			_uri = val;
		},
		enumerable: true
	});

	Object.defineProperty(this,'source',{
		get: function() {
			return (self.uri.indexOf('xsi://')===0) ? 'broadcast' : 'pvr';
		},
		enumerable: true
	});

	Object.defineProperty(this,'uri_idHex',{
		get: function() {
			return (self.uri.indexOf('xsi://')===0) ? self.uri.substr('xsi://'.length) : self.uri.substr('file://'.length);
		},
		enumerable: true
	});

	Object.defineProperty(this,'uri_id',{
		get: function() {
			return parseInt((self.uri.indexOf('xsi://')===0) ? self.uri.substr('xsi://'.length) : self.uri.substr('file://'.length),16);
		},
		enumerable: true
	});

	this.inspect = function() {
		return JSON.stringify(this);
	};

	this.fromRawEvent = function(rawEvent) {
		self.playSpeed = rawEvent.TransportPlaySpeed.$.val;
		self.uri = rawEvent.CurrentTrackURI.$.val;
	};

	if (rawEvent) this.fromRawEvent(rawEvent);

};

module.exports = SkyPlusHDState;