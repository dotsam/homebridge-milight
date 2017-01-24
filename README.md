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
                "version": "v6",
                "lights": {"fullColor": ["Kitchen",null,"Bedroom","Hallway"],
                           "rgbw": ["Living Room", "Downstairs Bedroom"]},
                "repeat": 1,
                "delay": 100
              },
              {
                "ip_address": "10.0.1.26",
                "lights": {"white": ["Dining Room", "Den"],
                           "rgbw": ["Master Bedroom"]}
              }
            ]
        }
]
```

Where the parameters are:

 * platform: This must be "MiLight", and refers to the name of the platform as defined in the module (required)
 * name: The display name used for logging output by Homebridge. Could be "MiLight" or "LimitlessLED" or whatever you'd like to see in logs and as the Manufacturer
 * bridges: An array of the bridges that will be configured by the platform, containing the following keys
   * ip_address: The IP address of the WiFi Bridge (optional - default: 255.255.255.255 aka broadcast to all bridges, but a specific IP address is recommended)
   * port: Port of the WiFi bridge (optional - default 8899)
   * version: What version of the bridge this is. Set "v6" for latest bridge, "v3" for 2-byte UDP messages, or "v2" for 3-byte UDP messages  (optional - default "v2")
   * delay: Delay in ms between commands sent over UDP. May cause heavy command queuing when set too high. Try decreasing to improve performance (optional - default 100)
   * repeat: Number of times to repeat the UDP command for better reliability. For rgb or white bulbs, this should be set to 1 so as not to change brightness/temperature more than desired (optional - default 3)
   * lights: An object whose properties are one of "fullColor", "rgbw", "rgb", or "white", depending on the type of bulb, and whose value is an array of the names of the zones, in order, 1-4. Use `null` if a zone is skipped. RGB lamps can only have a single zone. (required)

#Bridge Versions
The `version` referred to in the config above matches the versioning used by limitlessled.com. They refer to the "v6" bridge as the bridge released in late 2016. One version of this bridge has a built-in LED that is not yet supported by this plugin. This bridge is referred to elsewhere as bridge "3.0" or "iBox 2", but should still be configured in this plugin as "v6".

This plugin previously used 3-byte UDP commands as the default, which the "v1" and "v2" bridges required, but "versions" 3-5 all supported a shorter 2-byte sequence which some users may see better results with. This command set also uses an expanded brightness range for RGBW bulbs, which hasn't been confirmed to actually make any difference.

# Tips and Tricks
 * Setting the brightness of an rgbw or a white bulb to between 1% and 5% will set it to "night mode", which is dimmer than the normal lowest brightness setting
 * A brightness setting of 0% is equivalent to sending an Off command
 * White and rgb bulbs don't support absolute brightness setting, so we keep track of the last brightness value set and send the appropriate number of up/down commands to get to the new value
 * Implemented warmer/cooler for white lamps in the same way as brightness
 * There is only one-way communication with the bulbs, so when restarting Homebridge, it's a good idea to send a brightness and colour command to all bulbs to get them in sync, and then refrain from using any external (to Homebridge) apps to control the bulbs.

# Troubleshooting
The node-milight-promise library provides additional debugging output when the MILIGHT_DEBUG environmental variable is set. To get maximum debugging output from this plugin, start Homebridge like so:
`MILIGHT_DEBUG=true homebridge -D`

# Changelog

### 0.1.7
 * Fix bug setting hue correctly on v6 bridges

### 0.1.6
 * New config format where the `bridges` key actually defines one bridge now, with a `lights` key that defines a type of light and then name of the bulbs. Still backwards compatible with the old format, and actually still backwards compatible with an even older config version that only supported one bridge per platform definition. Both of these older configuration formats will be removed in 1.0.0.
 * We were doing things Wrong© before by creating multiple MiLight bridge objects for one physical bridge when we were using multiple bulb types on that bridge. With the new config, we now only create one bridge per device and send the appropriate commands for the bulb type. This should now actually queue commands properly as intended, and may fix issues with the v6 bridge.

### 0.1.5
 * Initial support for v6 bridge and full colour bulbs. This is a work in progress, please check for/open Github issues for any problems encountered.
 * Better switching between white and colour modes

### 0.1.4
 * Code cleanup
 * Track brightness/colour temp of non-rgbw bulbs and send the appropriate number of up/down commands. Will need to control bulbs exclusively with this plugin for this to work, and will also need to get all bulbs to a known state (I suggest turning on all lights and setting them to full brightness).

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
 * Initial move over to plugin architecture

