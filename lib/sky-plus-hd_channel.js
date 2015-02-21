"use strict";

var _ = require('underscore');
var moment = require('moment');
var q = require('q');
var util = require('util');

var SkyPlusHDHttpRequest = require('./sky-plus-hd_http-request');

/**
 * SkyPlusHDChannel
 */
var SkyPlusHDChannel = function(name, nameLong, number, id) {
	var self = this;
	//
	this.name = name;
	this.nameLong = nameLong || name;
	this.number = number;
	this.id = id;
	//
	this.getSchedule = function() {
		var deferred = q.defer();
		var forDate = moment();
		var quarterOfDay = Math.floor(forDate.hour()/6);
		var dayString = forDate.format('YYYY-MM-DD');
		var url = util.format("http://tv.sky.com/programme/channel/%s/%s/%d.json", self.id, dayString, quarterOfDay);
		SkyPlusHDHttpRequest.getJson(url).then(function(response) {
			var programmes = _.map(response.body.listings[self.id],function(prog) {
				return {
					id: prog.m[0],
					title: prog.t,
					description: prog.d,
					start: new Date(1000*prog.s),
					end: new Date(1000*prog.s + 1000*(prog.m[1]))
				};
			});
			deferred.resolve(programmes);
		}).catch(deferred.reject).done();
		return deferred.promise;
	};
};

module.exports = SkyPlusHDChannel;