
/**
 * SkyPlusHD
 * @class
 */
var SkyPlusHD = module.exports.SkyPlusHD = function() {

	var self = this;

	this.findBox = function SkyPlusHD_findBox(filter) {
		var deferred = q.defer();
		q.all([
			discoverService(ServiceDefinitions.SkyRC, filter),
			discoverService(ServiceDefinitions.SkyBrowse, filter)
		]).then(function(results) {
			var skyRC = results[0];
			var skyBrowse = results[1];
			//
			var box = new SkyPlusHDBox({
				ip: skyRC.rinfo.address,
				port: skyRC.rinfo.port,
				xml: [skyRC.msg.LOCATION, skyBrowse.msg.LOCATION]
			});
			box.on('ready',function() {
				deferred.resolve(box);
			});
		}).fail(function(err) {
			deferred.reject(err);
		}).done();
		return deferred.promise;
	}
}

/**
 * SkyPlusHDBox - representation of a single physical SkyPlusHD box
 * @class
 */
var SkyPlusHDBox = module.exports.SkyPlusHDBox = function() {

	var self = this;


}