"use strict";

var SkyPlusHDBoxModels = {
	/* Object key is a regex that model strings will be tested against
		Order of the patterns here is very important */
	patterns: {
		'4E30..': {name:'DSI8215', capacity: '300GB'},
		'9F30..': {name:'TDS850NB', capacity: '300GB'},
		'9730..': {name:'HDSKY 300GB', capacity: '300GB'},
		'973B..': {name:'HDSKY 500GB', capacity: '500GB'},
		'4F30..': {name:'DRX780', capacity: '300GB'},
		'4F3133': {name:'DRX890WL', capacity: '500GB'},
		'4F313.': {name:'DRX890W', capacity: '500GB'},
		'4F315[56]': {name:'DRX895', capacity: '2TB'},
		'4F315.': {name:'DRX895', capacity: '1.5TB'},
		'4F317.': {name:'DRX895W', capacity: '2TB'},
		'4F31E8': {name:'DRX895WL', capacity: '2TB'},
		'4F31..': {name:'DRX890', capacity: '500GB'},
	},
	match: function(model) {
		var match = {name: 'UNKNOWN', capacity: 'UNKNOWN'};
		for (var i in this.patterns) {
			if (new RegExp('^'+i+'$').test(model.toUpperCase())) {
				match = this.patterns[i];
				break;
			}
		}
		return match;
	}
};

module.exports = SkyPlusHDBoxModels;