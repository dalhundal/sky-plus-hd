sky-plus-hd
===

A Node.js module for controlling and monitoring Sky+ HD set top boxes.

Install
===
    npm install sky-plus-hd
    
Usage
===

In a nutshell:

Monitoring for channel changes
---

    var SkyPlusHD = require('sky-plus-hd');
    
    var sky = new SkyPlusHD({ host: '{IP-ADDRESS-OF-YOUR-SKY+HD-BOX' });
    
    sky.on('change',function(info) {
        console.log(info.channel.name); // Outputs current channel name
        console.log(info.channel.channel); // Outputs current channel number
        console.log(info.program.now.title); // Outputs current program title
        console.log(info.program.now.description); // Outputs current program synopsis
    });
    
    sky.monitor();
    
    
Controlling the Sky+ HD box
---

    var SkyPlusHD = require('sky-plus-hd');
    
    var sky = new SkyPlusHD({ host: '{IP-ADDRESS-OF-YOUR-SKY+HD-BOX' });
    
    sky.changeChannel(101); // Changes to BBC1