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
            "bridges": [
              {
                "ip_address": "10.0.1.25",
                "type": "rgbw",
                "zones": [null,"Kitchen","Bedroom","Hallway"],
                "repeat": 5,
                "delay": 30
              },
              {
                "ip_address": "10.0.1.4",
                "type": "white",
                "zones": ["Living Room","Dining Room"],
                "repeat": 1
              }]
        }
]
```

Where the parameters are:

 * platform: This must be "MiLight", and refers to the name of the platform as defined in the module (required)
 * name: The display name used for logging output by Homebridge. Could be "MiLight" or "LimitlessLED" or whatever you'd like to see in logs and as the Manufacturer
 * bridges: An array of the bridges that will be configured by the platform, containing the following keys
   * ip_address: The IP address of the WiFi Bridge (optional - default: 255.255.255.255 aka briadcast to all bridges)
   * port: Port of the WiFi bridge (optional - default 8899)
   * type: One of either "rgbw", "rgb", or "white", depending on the type of bulb being controlled. This applies to all zones (optional - default "rgbw")
   * delay: Delay in ms between commands sent over UDP. May cause heavy command queuing when set too high. Try decreasing to improve preformance (optional - default 30)
   * repeat: Number of times to repeat the UDP command for better reliability. For rgb or white bulbs, this should be set to 1 so as not to change brightness/temperature more than desired (optional - default 3)
   * zones: An array of the names of the zones, in order, 1-4. Use `null` if a zone is skipped. RGB lamps can only have a single zone. (required)

# Tips and Tricks
 * Setting the brightness of an rgbw or a white bulb to between 1% and 5% will set it to "night mode", which is dimmer than the normal lowest brightness setting
 * A brighness setting of 0% is equivilant to sending an Off command
 * White and rgb bulbs don't support absolute brightness setting, so we just send a brightness up/brightness down command depending if we got a percentage above/below 50% respectively
 * The only exception to the above is that white bulbs support a "maximum brightness" command, so we send that when we get 100%
 * Implemented warmer/cooler for white lamps in a similar way to brightnes, except this time above/below 180 degrees on the colour wheel

# Troubleshooting
The node-milight-promise library provides additional debugging output when the MILIGHT_DEBUG environmental variable is set

# Changelog

### 0.1.3
 * Further enhancements to setting white/colour correctly
 * Now uses setCharacteristic before brightness/hue/saturation instead of a direct sendCommand. This way, HomeKit knows we've turned the bulb on and keeps status in sync better.

### 0.1.2
 * Properly handle all cases where we might be setting the bulb to white

### 0.1.1
 * Fix bug where a MiLight controller object was created for each lamp, thus breaking the repeat and delay logic of the node-milight-promise library.

### 0.1.0
 * Refactor to better coding practices
 * Implement new config format that allows multiple bridges in the single platform definition. Old format is still supported for now, but this will be removed in a future version.
 * The platform name is now used as the Manufacturer in the Information service
 * Added Saturation characteristic. Note that MiLight bulbs don't actually support this, but the characteristic is needed for setting colours in all apps properly. Bulbs are set to white when hue = 0
 * Added Name characteristic to the Lightbulb service

### 0.0.3
 * Split out and expanded documentation to README

### 0.0.2
 * Small typo bugfix

### 0.0.1
 * Initial move over to plugin archtecture

