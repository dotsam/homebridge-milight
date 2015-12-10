# homebridge-milight
MiLight/LimitlessLED/Easybulb Plugin for [Homebridge](https://github.com/nfarina/homebridge)

Uses the [node-milight-promise](https://github.com/mwittig/node-milight-promise) library which features some code from
[applamp.nl](http://www.applamp.nl/service/applamp-api/) and uses other details from http://www.limitlessled.com/dev/

# Installation
1. Install [Homebridge](https://github.com/nfarina/homebridge) globally: `npm install -g homebridge`
2. Install homebridge-milight globally: `npm install -g homebridge-milight`
3. Configure the plugin as below
See the Homebridge [installation section](https://github.com/nfarina/homebridge#installation) for more details.

# Configuration

Example config:

```
"platforms": [
        {
            "platform":"MiLight",
            "name":"MiLight",
            "ip_address": "255.255.255.255",
            "port": 8899,
            "type": "rgbw",
            "delay": 30,
            "repeat": 3,
            "zones":["Kitchen Lamp","Bedroom Lamp",null,"Hallway Lamp"]
        }
]
```

Where the parameters are:

 * platform: This must be "MiLight", and refers to the name of the platform as defined in the module (required)
 * name: The display name used for logging output by Homebridge. Best to set to "MiLight" (required)
 * ip_address: The IP address of the WiFi Bridge (optional - default: 255.255.255.255)
 * port: Port of the WiFi bridge (optional - default 8899)
 * type: One of either "rgbw", "rgb", or "white", depending on the type of bulb being controlled. This applies to all zones (optional - default "rgbw")
 * delay: Delay in ms between commands sent over UDP. May cause heavy command queuing when set too high. Try decreasing to improve preformance (optional - default 30)
 * repeat: Number of times to repeat the UDP command for better reliability. (optional - default 3)
 * zones: An array of the names of the zones, in order, 1-4. Use `null` if a zone is skipped. RGB lamps can only have a single zone. (required)

# Tips and Tricks
 * Setting the brightness of an rgbw or a white bulb to 1% or 2% will set it to "night mode", which is dimmer than the normal lowest brightness setting
 * White and rgb bulbs don't support absolute brightness setting, so we just send a brightness up/brightness down command depending if we got a percentage above/below 50% respectively
 * The only exception to the above is that white bulbs support a "maximum brightness" command, so we send that when we get 100%
 * Implemented warmer/cooler for white lamps in a similar way to brightnes, except this time above/below 180 degrees on the colour wheel

# Troubleshooting
The node-milight-promise library provides additional debugging output when the MILIGHT_DEBUG environmental variable is set