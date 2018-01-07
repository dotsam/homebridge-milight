var Milight = require("node-milight-promise").MilightController;
var helper = require("node-milight-promise").helper;
var inherits = require("util").inherits;
var debounce = require("underscore").debounce;

"use strict";

var Service, Characteristic;

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerPlatform("homebridge-milight", "MiLight", MiLightPlatform);
};

function MiLightPlatform(log, config) {
  this.log = log;
  this.config = config;
}

MiLightPlatform.prototype.accessories = function(callback) {
  var foundBulbs = [];
  var bridgeControllers = {};
  var platform = this;

  if (this.config.bridges.length > 0) {
    for (var bridgeConfig of this.config.bridges) {

      // Construct or parse unique bridge host address
      if (bridgeConfig.host) {
        var hostBits = bridgeConfig.host.split(":");
        bridgeConfig.ip_address = hostBits[0];
        bridgeConfig.port = parseInt(hostBits[1], 10);
      } else {
        bridgeConfig.host = bridgeConfig.ip_address ? bridgeConfig.ip_address : "";
        if (bridgeConfig.port) {
          bridgeConfig.host += ":" + bridgeConfig.port;
        }
      }

      if (bridgeConfig.lights && Object.keys(bridgeConfig.lights).length > 0) {

        // Setting appropriate commands per bridge version. Defaults to v2 as those are the commands that previous versions of the plugin used
        if (!bridgeConfig.version) {
          bridgeConfig.version = "v2";
        }

        // Set default debounce time (in miliseconds)
        if (!bridgeConfig.debounceTime) {
          bridgeConfig.debounceTime = 150;
        }

        for (var lightType in bridgeConfig.lights) {
          if (["fullColor", "rgbw", "rgb", "white", "bridge"].indexOf(lightType) === -1) {
            this.log.error("Invalid bulb type '%s' specified.", lightType);
          } else if (bridgeConfig.version !== "v6" && ["fullColor", "bridge"].indexOf(lightType) > -1) {
            this.log.error("Bulb type '%s' only available with v6 bridge!", lightType);
          } else {
            var zonesLength = bridgeConfig.lights[lightType].length;

            if (zonesLength < 1) {
              this.log.error("No bulbs found in '%s' configuration.", lightType);
              zonesLength = 0;
            } else if (["rgb", "bridge"].indexOf(lightType) > -1 && zonesLength > 1) {
              this.log.warn("Bulb type '%s' only supports a single zone. Only the first defined bulb will be used.", lightType);
              zonesLength = 1;
            } else if (zonesLength > 4) {
              if (bridgeConfig.version !== "v6") {
                this.log.warn("Only a maximum of 4 zones per bulb type are supported per bridge. Only recognizing the first 4 zones.");
                zonesLength = 4;
              } else if (lightType === "fullColor" && bridgeConfig.use8Zone === undefined) {
                this.log.info("More than 4 fullColor bulbs added to a v6 bridge, enabling 8-zone support. May not work with all bridges/bulbs. Set the `use8Zone` property of the bridge config to either silence this message or disable this functionality.")
                bridgeConfig.use8Zone = true;

                if (zonesLength > 8) {
                  this.log.warn("Only a maximum of 8 zones per bulb type are supported per bridge. Only recognizing the first 8 zones.");
                  zonesLength = 8;
                }
              } else if (lightType === "fullColor" && bridgeConfig.use8Zone === false) {
                zonesLength = 4;
                bridgeConfig.use8Zone = false;
              }
            }

            if (zonesLength > 0) {
              // If it hasn't been already, initialize a new controller to be used for all zones defined for this bridge
              if (typeof(bridgeControllers[bridgeConfig.host]) != "object") {
                bridgeControllers[bridgeConfig.host] = new Milight({
                  ip: bridgeConfig.ip_address,
                  port: bridgeConfig.port,
                  host: bridgeConfig.host,
                  delayBetweenCommands: bridgeConfig.delay,
                  commandRepeat: bridgeConfig.repeat,
                  type: bridgeConfig.version,
                  fullSync: bridgeConfig.fullSync || false,
                  sendKeepAlives: bridgeConfig.sendKeepAlives,
                  sessionTimeout: bridgeConfig.sessionTimeout
                });

                // Attach the right commands to the bridgeController object
                if (bridgeConfig.version === "v6") {
                  bridgeControllers[bridgeConfig.host].commands = require("node-milight-promise").commandsV6;
                } else if (bridgeConfig.version === "v3") {
                  bridgeControllers[bridgeConfig.host].commands = require("node-milight-promise").commands2;
                } else {
                  bridgeControllers[bridgeConfig.host].commands = require("node-milight-promise").commands;
                }

                // Used to keep track of the last targeted bulb
                bridgeControllers[bridgeConfig.host].lastSent = {
                  bulb: null
                };
              }

              // Create bulb accessories for all of the defined zones
              for (var i = 0; i < zonesLength; i++) {
                var bulbConfig = {};
                if (bulbConfig.name = bridgeConfig.lights[lightType][i]) {
                  if (lightType === "fullColor" && bridgeConfig.use8Zone === true) {
                    bulbConfig.type = "fullColor8Zone";
                  } else {
                    bulbConfig.type = lightType;
                  }
                  bulbConfig.zone = i + 1;
                  bulbConfig.debounceTime = bridgeConfig.debounceTime;
                  var bulb = new MiLightAccessory(bulbConfig, bridgeControllers[bridgeConfig.host], this.log);
                  foundBulbs.push(bulb);
                } else if (bridgeConfig.lights[lightType][i] !== null) {
                  this.log.error("Unable to add light from '%s' array, index %d", lightType, i);
                }
              }
            }
          }
        }
      } else {
        this.log.error("Could not read any lights from bridge %s", bridgeConfig.host);
      }
    }
  } else {
    this.log.error("No bridges defined.");
  }

  if (foundBulbs.length <= 0) {
    this.log.error("No valid bulbs found in any bridge.");
  }

  // Catch errors from node-milight-promise
  for (const bridgeController in bridgeControllers) {
    bridgeControllers[bridgeController].ready().catch(function(e) {
      platform.log.error("[%s] %s", bridgeController, e.message);
    });
  }

  callback(foundBulbs);
};

function MiLightAccessory(bulbConfig, bridgeController, log) {
  this.log = log;

  // config info
  this.name = bulbConfig.name;
  this.zone = bulbConfig.zone;
  this.type = bulbConfig.type;
  this.debounceTime = bulbConfig.debounceTime;

  // Used to internally track values so we know when to actually send commands (order is important)
  // Should match HAP Characteristic.getDefaultValue()
  this.internalValue = {};
  this.internalValue.On = false;
  this.internalValue.Saturation = 0;
  this.internalValue.ColorTemperature = 153;
  this.internalValue.Hue = 0;
  this.internalValue.Brightness = 0;

  this.colorMode = false; // Default to white mode
  this.whiteBrightness = 0;
  this.colorBrightness = 0;

  // assign to the bridge
  this.light = bridgeController;

  // set the version from the bridge
  this.version = this.light.type;

  // use the right commands for this bridge
  this.commands = this.light.commands;

  // keep track of the last bulb an 'on' command was sent to
  this.lastSent = this.light.lastSent;

  // Set up our debounce handler here so we have access to the object properties we need
  this.debounceUpdateBulb = debounce(this.updateBulb, this.debounceTime);
}

MiLightAccessory.prototype.setOn = function(value, callback) {
  if (value) {
    if (this.lastSent.bulb === this.type + this.zone) {
      this.log.debug("[" + this.name + "] Omitting 'on' command as we've sent it to this bulb most recently");
    } else {
      this.log("[" + this.name + "] Setting power state to on");
      this.lastSent.bulb = this.type + this.zone;
      this.light.sendCommands(this.commands[this.type].on(this.zone));
    }
  } else {
    this.log("[" + this.name + "] Setting power state to off");
    this.lastSent.bulb = null;
    this.light.sendCommands(this.commands[this.type].off(this.zone));
  }
  this.internalValue.On = value;
  callback(null);
};

MiLightAccessory.prototype.setBrightness = function(value, callback) {
  if (value === 0) {
    // If brightness is set to 0, turn off the bulb
    this.log("[" + this.name + "] Setting brightness to 0 (off)");
    this.lightbulbService.setCharacteristic(Characteristic.On, false);
  } else if (value <= 5 && this.type !== "rgb") {
    // If setting brightness to 5 or lower, instead set night mode for bulbs that support it
    this.log("[" + this.name + "] Setting night mode");

    this.light.sendCommands(this.commands[this.type].off(this.zone));
    // Ensure we're pausing for 100ms between these commands as per the spec
    this.light.pause(100);
    this.light.sendCommands(this.commands[this.type].nightMode(this.zone));

    // Manually clear last bulb sent so that "on" is sent when we next interact with this bulb
    this.lastSent.bulb = null;

  } else {
    // Send on command to ensure we're addressing the right bulb
    this.lightbulbService.setCharacteristic(Characteristic.On, true);

    this.log("[" + this.name + "] Setting brightness to %s", value);

    // If bulb supports it, set the absolute brightness specified
    if (["rgb", "white"].indexOf(this.type) === -1) {
      if (this.version === "v6" && this.type !== "bridge") {
        this.light.sendCommands(this.commands[this.type].brightness(this.zone, value));
      } else {
        this.light.sendCommands(this.commands[this.type].brightness(value));
      }
    } else {
      // If this is an rgb or a white bulb, they only support brightness up and down.
      if (this.type === "white" && value === 100) {
        // But the white bulbs do have a "maximum brightness" command
        this.light.sendCommands(this.commands[this.type].maxBright(this.zone));
      } else {
        // We're going to send the number of brightness up or down commands required to get to get from
        // the current value that HomeKit knows to the target value

        var currentLevel = this.internalValue.Brightness;

        var targetDiff = value - currentLevel;
        var targetDirection = Math.sign(targetDiff);
        targetDiff = Math.max(0, (Math.round(Math.abs(targetDiff) / 10))); // There are 10 steps of brightness

        if (targetDirection === 0 || targetDiff === 0) {
          this.log("[" + this.name + "] Change not large enough to move to next step for bulb");

          // Don't change the internal value since we didn't make any change
          value = currentLevel;
        } else {
          this.log.debug("[" + this.name + "] Setting brightness to internal value %d (%d steps away)", Math.round(currentLevel / 10), targetDiff);

          for (; targetDiff > 0; targetDiff--) {
            if (targetDirection === 1) {
              this.light.sendCommands(this.commands[this.type].brightUp(this.zone));
              this.log.debug("[" + this.name + "] Sending brightness up command");
            } else if (targetDirection === -1) {
              this.light.sendCommands(this.commands[this.type].brightDown(this.zone));
              this.log.debug("[" + this.name + "] Sending brightness down command");
            }
          }
        }
      }
    }
  }
  this.internalValue.Brightness = value;

  callback(null);
};

MiLightAccessory.prototype.setHue = function(value, callback) {
  // Send on command to ensure we're addressing the right bulb
  this.lightbulbService.setCharacteristic(Characteristic.On, true);

  this.log("[" + this.name + "] Setting hue to %s", value);

  this.swapBrightnessValues(true);

  if (this.version === "v6" && this.type !== "bridge") {
    this.light.sendCommands(this.commands[this.type].hue(this.zone, helper.hsvToMilightColor([value, 0, 0]), true));
  } else {
    this.light.sendCommands(this.commands[this.type].hue(helper.hsvToMilightColor([value, 0, 0]), true));
  }

  this.internalValue.Hue = value;
  callback(null);
};

MiLightAccessory.prototype.setSaturation = function(value, callback) {
  if (["rgbw", "bridge", "fullColor", "fullColor8Zone"].indexOf(this.type) > -1) {
    if (value === 0) {
      // Send on command to ensure we're addressing the right bulb
      this.lightbulbService.setCharacteristic(Characteristic.On, true);

      this.log("[" + this.name + "] Saturation set to 0, setting bulb to white");

      this.swapBrightnessValues(false);

      // If this is a fullColor bulb, set the colour temperature to the last stored value, else (rgbw or bridge) just set to white mode
      if (["fullColor", "fullColor8Zone"].indexOf(this.type) > -1) {
        this.setColorTemperature(this.lightbulbService.getCharacteristic(Characteristic.ColorTemperature).value, function() {});
      } else {
        this.light.sendCommands(this.commands[this.type].whiteMode(this.zone));
      }
    } else if (["fullColor", "fullColor8Zone"].indexOf(this.type) > -1) {
      // Send on command to ensure we're addressing the right bulb
      this.lightbulbService.setCharacteristic(Characteristic.On, true);

      this.log("[" + this.name + "] Setting saturation to %s", value);

      this.light.sendCommands(this.commands[this.type].saturation(this.zone, value, true));
    } else {
      this.log("[" + this.name + "] Saturation set to non-zero value %d, setting %s bulb back to colour mode", value, this.type);
      this.setHue(this.lightbulbService.getCharacteristic(Characteristic.Hue).value, function() {});
    }
  } else {
    this.log.info("[" + this.name + "] Setting saturation to %s (NOTE: No impact on %s %s bulbs)", value, this.type, this.log.prefix);
  }

  this.internalValue.Saturation = value;
  callback(null);
};

MiLightAccessory.prototype.setColorTemperature = function(value, callback) {
  if (["fullColor", "fullColor8Zone"].indexOf(this.type) > -1) {
    // Send on command to ensure we're addressing the right bulb
    this.lightbulbService.setCharacteristic(Characteristic.On, true);

    this.log("[" + this.name + "] Setting color temperature to %sK", Math.round(1000000 / value));

    // There are only 100 steps of color temperature for fullColor bulbs, so let's convert from megakelvin to a value from 0-100
    var miLightValue = this.mkToMilight(value, 100);

    this.swapBrightnessValues(false);

    this.log.debug("[" + this.name + "] Setting bulb color temperature to internal value %s", miLightValue);

    this.light.sendCommands(this.commands[this.type].whiteTemperature(this.zone, miLightValue));
  } else if (this.type === "white") {
    // Send on command to ensure we're addressing the right bulb
    this.lightbulbService.setCharacteristic(Characteristic.On, true);

    // White bulbs don't support setting an absolue colour temp, so we'll do some math to figure out how to get there
    var currentLevel = this.internalValue.ColorTemperature;

    var targetDiff = this.mkToMilight(currentLevel, 10) - this.mkToMilight(value, 10);
    var targetDirection = Math.sign(targetDiff);
    targetDiff = Math.abs(targetDiff);

    if (targetDirection === 0 || targetDiff === 0) {
      this.log("[" + this.name + "] Change not large enough to move to next step for bulb");

      // Don't change the internal value since we didn't make any change
      value = currentLevel;
    } else {
      this.log("[" + this.name + "] Setting color temperature to %sK", Math.round(1000000 / value));

      this.log.debug("[" + this.name + "] Setting bulb color temperature to internal value %d (%d steps away)", this.mkToMilight(value, 10), targetDiff);

      for (; targetDiff > 0; targetDiff--) {
        if (targetDirection === -1) {
          this.light.sendCommands(this.commands[this.type].cooler(this.zone));
          this.log.debug("[" + this.name + "] Sending bulb cooler command");
        } else if (targetDirection === 1) {
          this.light.sendCommands(this.commands[this.type].warmer(this.zone));
          this.log.debug("[" + this.name + "] Sending bulb warmer command");
        }
      }
    }
  }

  this.internalValue.ColorTemperature = value;
  callback(null);
};

MiLightAccessory.prototype.mkToMilight = function(mk, scale) {
  var props = this.lightbulbService.getCharacteristic(Characteristic.ColorTemperature).props;

  return Math.max(0, Math.abs((Math.round(Math.abs(mk - props.minValue) / ((props.maxValue - props.minValue) / scale))) - scale));
};

MiLightAccessory.prototype.swapBrightnessValues = function(mode) {
  if (this.colorMode) {
    this.colorBrightness = this.lightbulbService.getCharacteristic(Characteristic.Brightness).value;
  } else {
    this.whiteBrightness = this.lightbulbService.getCharacteristic(Characteristic.Brightness).value;
  }
  this.colorMode = mode;

  // Update the cached brightness value to the one for the mode we're switching in to
  this.lightbulbService.updateCharacteristic(Characteristic.Brightness, this.colorMode ? this.colorBrightness : this.whiteBrightness);
};

MiLightAccessory.prototype.updateBulb = function() {
  for (var characteristic in this.internalValue) {
    // If the bulb has the service we're looking at, and our internal stored value is different from the HomeKit value (or special case "On")
    if (this.lightbulbService.testCharacteristic(Characteristic[characteristic]) && (this.internalValue[characteristic] !== this.lightbulbService.getCharacteristic(Characteristic[characteristic]).value) || characteristic === "On") {
      this.log.debug("[" + this.name + "] Processing value %s for characteristic %s", this.lightbulbService.getCharacteristic(Characteristic[characteristic]).value, characteristic);

      if (characteristic === "On" && this.lightbulbService.getCharacteristic(Characteristic.Brightness).value <= 5 && this.type !== "rgb") {
        this.internalValue[characteristic] = this.lightbulbService.getCharacteristic(Characteristic[characteristic]).value;
        this.log.debug("[" + this.name + "] Bulb to be set to night mode, avoiding sending 'on' command");
        continue;
      }
      if (characteristic === "Hue" && this.lightbulbService.getCharacteristic(Characteristic.Saturation).value === 0) {
        this.internalValue[characteristic] = this.lightbulbService.getCharacteristic(Characteristic[characteristic]).value;
        this.log.debug("[" + this.name + "] Not setting bulb hue to %d as we've already put the bulb in white mode (saturation == 0)", this.lightbulbService.getCharacteristic(Characteristic[characteristic]).value);
        continue;
      } else if (characteristic === "Hue" && this.lightbulbService.getCharacteristic(Characteristic.Saturation).value !== 0) {
        //NOOP
      }
      var functionName = "set" + characteristic;
      this[functionName](this.lightbulbService.getCharacteristic(Characteristic[characteristic]).value, function() {});
    } else if (this.internalValue[characteristic] === this.lightbulbService.getCharacteristic(Characteristic[characteristic]).value) {
      this.log.debug("[" + this.name + "] Characteristic %s is already set to %s, no action taken", characteristic, this.lightbulbService.getCharacteristic(Characteristic[characteristic]).value);
    }
  }
};

MiLightAccessory.prototype.update = function(characteristic, value, callback) {
  // All "set" events now trigger this function, which calls the debounced function `updateBulb` which goes through and sends commands after the debounce timeout
  // This should allow for the correct ordering of commands and simplifies some logic
  this.log.debug("[" + this.name + "] Recieved HomeKit request to set %s to %s ", characteristic, value);
  this.debounceUpdateBulb();
  callback(null);
};

MiLightAccessory.prototype.identify = function(callback) {
  this.log("[" + this.name + "] Identify requested!");
  callback(null); // success
};

MiLightAccessory.prototype.getServices = function() {
  this.informationService = new Service.AccessoryInformation();

  this.informationService
    .setCharacteristic(Characteristic.Manufacturer, this.log.prefix)
    .setCharacteristic(Characteristic.Model, this.type)
    .setCharacteristic(Characteristic.SerialNumber, "12345");

  this.lightbulbService = new Service.Lightbulb(this.name);

  this.lightbulbService
    .getCharacteristic(Characteristic.On)
    .on("set", this.update.bind(this, 'On'));

  this.lightbulbService
    .addCharacteristic(new Characteristic.Brightness())
    .on("set", this.update.bind(this, 'Brightness'));

  if (["fullColor", "fullColor8Zone", "rgbw", "rgb", "bridge"].indexOf(this.type) > -1) {
    this.lightbulbService
      .addCharacteristic(new Characteristic.Saturation())
      .on("set", this.update.bind(this, 'Saturation'));

    this.lightbulbService
      .addCharacteristic(new Characteristic.Hue())
      .on("set", this.update.bind(this, 'Hue'));
  }

  if (["fullColor", "fullColor8Zone", "white"].indexOf(this.type) > -1) {
    this.lightbulbService
      .addCharacteristic(new Characteristic.ColorTemperature())
      // maxValue 370 = 2700K (1000000/2700)
      // minValue 153 = 6500K (1000000/6500)
      .setProps({
        maxValue: 370,
        minValue: 153
      })
      .updateValue(153)
      .on("set", this.update.bind(this, 'ColorTemperature'));
  }

  return [this.informationService, this.lightbulbService];
};
