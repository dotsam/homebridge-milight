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
                "delay": 100,
                "repeat": 1,
                "debounce": 150
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
   * debounce: Time in ms to debounce commands from HomeBridge. Default is 150ms which seems sane in testing, but feedback is appreciated if you change this setting.
   * use8Zone: Boolean value, only used when there are more than 4 fullColor bulbs added to a v6 bridge. This should function without this property being set, but an info message is printed out as not all bridge/bulb firmwares support this.
   * lights: An object whose properties are one of "fullColor", "rgbw", "rgb", "bridge" (the built-in light in the iBox 1), or "white", depending on the type of bulb, and whose value is an array of the names of the zones, in order, 1-4. Use `null` if a zone is skipped. RGB lamps and the bridge light can only have a single zone. (required)

#Bridge Versions
The `version` referred to in the config above matches the versioning used by limitlessled.com. They refer to the "v6" bridge as the bridge released in late 2016. The original manufacturer, Futlight, refers to the new version of the bridge as the "iBox". The iBox1 is the version with a built-in light (configured as "bridge" bulb type), while the iBox2 is a similar design to the previous bridges. The newer bridge is also, confusingly, referred to as bridge "3.0" by some sellers. Regardless, all of the iBox/3.0 variants should be configured as version "v6".

This plugin previously used 3-byte UDP commands as the default, which the "v1" and "v2" bridges required, but "versions" 3-5 all supported a shorter 2-byte sequence which some users may see better results with. This command set also uses an expanded brightness range for RGBW bulbs, which hasn't been confirmed to actually make any difference.

Some of the iBox bridges have also been shipping set to only listen for TCP commands. This plugin uses only UDP commands. To make it work, you will need to log in to the web admin interface of the bridge (Username: admin, Password: admin), go to the "Other Setting" section, and change the "Network Parameter" to UDP.

# Tips and Tricks
 * Setting the brightness of an `rgbw`, `fullColor`, `bridge`, or `white` bulb to between 1% and 5% will set it to "night mode", which is dimmer than the normal lowest brightness setting
 * A brightness setting of 0% is equivalent to sending an Off command
 * `white` and `rgb` bulbs don't support absolute brightness setting, so we keep track of the last brightness value set and send the appropriate number of up/down commands to get to the new value
 * Implemented warmer/cooler for `white` lamps in the same way as brightness
 * There is only one-way communication with the bulbs, so when restarting Homebridge, it's a good idea to send a brightness and colour command to all bulbs to get them in sync, and then refrain from using any external (to Homebridge) apps to control the bulbs.

# Troubleshooting
The node-milight-promise library provides additional debugging output when the MILIGHT_DEBUG environmental variable is set. To get maximum debugging output from this plugin, start Homebridge like so:
`MILIGHT_DEBUG=true homebridge -D`

# Changelog

### 1.2.1-beta1
 * Fix for a null zone/bulb defined in the config
 * Bump version to avoid version 1.2.0 that was previously published in error

### 1.2.0-beta2
 * Code cleanup for sanity and semantics
 * Default internal brightness value to 100 for consistency when turning bulbs on after a restart
 * Better debug logging for debounced update function

### 1.2.0-beta1
 * Added debouncing for all commands received from HomeKit. This allows us to order commands to the bulbs in the way that works best and perform additional logic. The debounce time is currently set to 150ms, which should be a very safe value to prevent command queueing and make sure that a full set of HSV values are received from HomeKit before acting on them. Lower values will cause lights to react more quickly, but could cause command queuing problems, or errors in setting light colour.
 * Now tracking white and colour brightness levels separately so values should correctly reflect based on what mode the lights are in

### 1.1.5
 * Hotfix for Homebridge plugin registration (Thanks @fkistner!)

### 1.1.4
 * Fix issues with 8 zone fullColor bulbs not being sent the correct commands
 * Bump minimum Homebridge version to 0.4.27 so we can be sure that the color temperature characteristic will be there, and we can simply modify min/max values
 * Basic error handling of connection promise from node-milight-promise
 * Ability to pass through all node-milight-promise options (`fullSync`, `sendKeepAlives`, `sessionTimeout`)

### 1.1.3
 * Switched to node-milight-promise ^0.3.0

### 1.1.2
 * Make sure we're enforcing the new maximum of 8 zones for v6/fullColor

### 1.1.1
 * Add support for 8-zone control of fullColor bulbs on v6 bridges (#39)
 * Support multiple bridges on the same IP with different ports (#34) (thanks @lundberg)
 * Update node-milight-promise to use master branch

### 1.1.0
 * Implemented colour temperature control with new official HomeKit characteristic. Not supported by all HomeKit apps
 * RGBWW/fullColor bulbs should be set to their last colour temperature value when going in to white mode
 * Fixed bug where bulb set in night mode might not be addressed again correctly for subsequent commands
 * Possible fix for RGBWW/fullColor bulbs not getting correct colours set depending on command order
 * Update node-milight-promise dependancy to ^0.2.2

### 1.0.1
 * Upgrade node-milight-promise dependancy to ^0.1.1 and use its new saturation inversion option

### 1.0.0
 * Removed support for legacy config formats, and cleaned up code
 * Track the last bulb addressed by a bridge so we can skip sending the "on" command to it. Should speed things up a bit
 * Invert the saturation value sent to fullColor bulbs so things work as expected

### 0.1.10
 * Fix command sending to the bridge light
 * Further tweaks to the logic of setting/resetting hue/saturation/white mode
 * This is likely the last release before an upcoming 1.0 release that will remove support for old config formats. Please check the Homebridge log to see if your configuration generates any warnings, and update your configuration as required.

### 0.1.9
 * Finally fix the bug where colour/white mode was not set correctly when changing hue/saturation
 * Added support for "bridge" bulb type to control the internal bulb on v6 bridges

### 0.1.8
 * Fixes destined for 0.1.7 were never actually pushed.

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
