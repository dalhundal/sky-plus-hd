## Features

- Search for SkyPlusHD boxes on the local network
- Control of SkyPlusHD boxes
	- Play
	- Pause
	- Stop
	- Fast forward / rewind at speeds of x2, x6, x12, x30
- Listen for channel change events
- Listen for playback events
	- Playing
	- Paused
	- Stopped
	- Fast forwarding
	- Rewinding

## Geting Started

### To install...


```sh
npm install sky-plus-hd
```

### To use...

```javascript
var SkyPlusHD = require('sky-plus-hd');

// Find the first available (or only) box on the network...
var findABox = SkyPlusHD.findBox();

// When the box is found and ready to use...
findABox.then(function(box) {
	console.log(box.model);
	console.log(box.capacity);
	console.log(box.software);
	console.log(box.serial);
	/** Example output:
		DRX890
		500GB
		R010.070.58.13P (4n1p6hh)
		321654987
	*/
});

// If no box was found...
findABox.fail(function(err) {
	console.log("No box was found on the network :-(");
	// Not the best or most helpful error messages in the world at the moment
	console.log(err);
});
```

If you have more than one SkyPlusHD box on your network, you probably want to connect to a specific one - you can specify an IP address like so;

```javascript
var findTheBox = SkyPlusHD.findBox('192.168.1.123');
```