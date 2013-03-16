sky-plus-hd
===

A Node.js module for controlling and monitoring Sky+ HD set top boxes. It will auto-detect your Sky+ HD box on your local network.

**This module is in development, and is changing rapidly. The API *will* change.** Please direct any comments or questions to [@ringspun][1].

The documentation below is quick and dirty, but should explain the salient points. Probably the best way to figure out how to use this module at the moment is to take a look at the examples included in the repository.

Install
===
    npm install sky-plus-hd
    
Usage
===

Monitoring for channel changes
---

    var SkyPlusHD = require('sky-plus-hd');
    
    var sky = new SkyPlusHD();
    
    sky.on('change',function(info) {
        console.log(info.channel.name); // Outputs current channel name
        console.log(info.channel.channel); // Outputs current channel number
        console.log(info.program.now.title); // Outputs current program title
        console.log(info.program.now.description); // Outputs current program synopsis
    });
    
    sky.on('ready',function() {
       sky.monitor();
    });
    
    
Controlling the Sky+ HD box
---

    var SkyPlusHD = require('sky-plus-hd');
    
    var sky = new SkyPlusHD();
    
    sky.on('ready',function() {
       sky.changeChannel(101); // Changes to BBC1
    });


Documentation
===

Controlling the Sky+HD box
---

* Changing the channel

        changeChannel(num)

    *num* is a normal Sky channel number (101 -> 999).

* Pause

        pause()

* Play

        play()

Monitoring the Sky+HD box
---
    
* Starts listening for notifications from the Sky+HD box

        monitor()

    As notifications are recieved, sky-plus-hd will emit events, which are described below.

* Stops listening for notifications from the Sky+HD box

        close()

    It is important that you endeavour to call this method before your program exits, if you have previously called *monitor*, so that sky-plus-hd unsubscribes to notifications. If you don't the Sky+HD box will later still be trying to send notifications to something that is no longer listening. I don't know what the adverse effects of this would be, but it would probably slow down notifications for anything listening later on, while it still tries to send notifications to a dead end point.

Getting information from the Sky+HD box
---

* Finds the Sky+HD box on your local network

        detect(fnCallback)

    *fnCallback* is a function that will be called when a Sky+HD box has been detected. It is passed an object with the property *address* which is the IPv4 address of the Sky+HD box.

* Get channel listing

        getChannelListing(channelId, fnCallback)

    Downloads the TV listing for the specified *channelId*, for the current day (12am -> 12am). *channelId* is not a normal Sky+HD channel number, but is the decimal id as found in the channels.json file. Once the channels schedule has been downloaded, *fnCallback* is called with the complete listing.

* Find out what channel / pvr is currently being viewed

        getMediaInfo(fnCallback)

    *fnCallback* will be called with an object containing either channel information if watching broadcast TV, or an ID of the PVR programme currently playing.

* List recorded programs

        readPlanner([options], fnCallback)

    *fnCallback* will be called with an array of objects for each of the recordings currently in the PVR. Some of these may have invalid dates etc, I think this may indicate that the programme is scheduled to be recorded rather than already exising at that point. *options* can be ommitted, valid properties for it are:

    * limit: number of results to return
    * offset: offset from which to start returning results
    * recursive [true | false]: whether to recurse in iterations of *limit* results until all results in the PVR are returned.

* Find out what is on now and next

        whatsOn(channelId, fnCallback)

    *fnCallback* will be called with an object detailing the current and next programs for the specified *channelId*. *channelId* is not a normal Sky+HD channel number, but is the decimal id as found in the channels.json file.

Events
---

* change

    Called when a channel change occurs / or when changing PVR program

* changeState

    Called when a pause / play / fwd / rwd event occurs


[1]: http://twitter.com/ringspun


