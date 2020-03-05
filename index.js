const Milight = require("node-milight-promise");
const MilightController = Milight.MilightController;
const MilightHelper = Milight.helper;
const debounce = require("underscore").debounce;

"use strict";

let Service, Characteristic;

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerPlatform("homebridge-milight", "MiLight", MiLightPlatform);
};

function MiLightPlatform(log, config, api) {
  this.log = log;
  this.config = config;

  if (api) {
    this.api = api;
  }
}

MiLightPlatform.prototype.accessories = function(callback) {
  const platform = this;
  let foundBulbs = [];
  let bridgeControllers = {};

  if (this.config.bridges.length > 0) {
    for (const bridgeConfig of this.config.bridges) {
      // Construct or parse unique bridge host address
      if (bridgeConfig.host) {
        const hostBits = bridgeConfig.host.split(":");
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

        for (const lightType in bridgeConfig.lights) {
          if (["fullColor", "rgbw", "rgb", "white", "bridge"].indexOf(lightType) === -1) {
            this.log.error("Invalid bulb type '%s' specified.", lightType);
          } else if (bridgeConfig.version !== "v6" && ["fullColor", "bridge"].indexOf(lightType) > -1) {
            this.log.error("Bulb type '%s' only available with v6 bridge!", lightType);
          } else {
            let zonesLength = bridgeConfig.lights[lightType].length;

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
                bridgeControllers[bridgeConfig.host] = new MilightController({
                  ip: bridgeConfig.ip_address,
                  port: bridgeConfig.port,
                  host: bridgeConfig.host,
                  delayBetweenCommands: bridgeConfig.delay,
                  commandRepeat: bridgeConfig.repeat,
                  type: bridgeConfig.version,
                  fullSync: bridgeConfig.fullSync || false,
                  sendKeepAlives: bridgeConfig.sendKeepAlives,
                  sessionTimeout: bridgeConfig.sessionTimeout,
                  commands: Milight.commands,
                  // Used to keep track of the last targeted bulb
                  lastSent: "",
                });

                // Change bridge command set based on version
                if (bridgeConfig.version === "v6") {
                  bridgeControllers[bridgeConfig.host].commands = Milight.commandsV6;
                } else if (bridgeConfig.version === "v3") {
                  bridgeControllers[bridgeConfig.host].commands = Milight.commands2;
                }
              }

              // Create bulb accessories for all of the defined zones
              for (let i = 0; i < zonesLength; i++) {
                if (bridgeConfig.lights[lightType][i] !== null) {
                  const bulbConfig = {
                    name: bridgeConfig.lights[lightType][i],
                    type: (lightType === "fullColor" && bridgeConfig.use8Zone === true) ? "fullColor8Zone" : lightType,
                    zone: i + 1,
                    debounceTime: bridgeConfig.debounceTime,
                  };

                  foundBulbs.push(new MiLightAccessory(bulbConfig, bridgeControllers[bridgeConfig.host], this.log));
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

  // assign to the bridge
  this.bridge = bridgeController;

  // use the right commands for this bridge
  this.commands = this.bridge.commands;

  // Used to internally track values so we know when to actually send commands (order is important)
  // Should match HAP Characteristic.getDefaultValue()
  this.state = {
    On: false,
    Saturation: 0,
    ColorTemperature: 153,
    Hue: 0,
    Brightness: 100,
    colorMode: false, // Default to white mode
    whiteBrightness: 100,
    colorBrightness: 100,
  };

  // Set up our debounce handler here so we have access to the object properties we need
  this.debounceUpdateBulb = debounce(this.updateBulb, this.debounceTime);
}

MiLightAccessory.prototype.setOn = function(value, callback) {
  if (value) {
    if (this.bridge.lastSent === this.type + this.zone) {
      this.log.debug("[%s] Omitting 'on' command as we've sent it to this bulb most recently", this.name);
    } else {
      this.log("[%s] Setting power state to on", this.name);
      this.bridge.lastSent = this.type + this.zone;
      this.bridge.sendCommands(this.commands[this.type].on(this.zone));
    }
  } else {
    this.log("[%s] Setting power state to off", this.name);
    this.bridge.lastSent = "";
    this.bridge.sendCommands(this.commands[this.type].off(this.zone));
  }

  callback();

  return value;
};

MiLightAccessory.prototype.setBrightness = function(value, callback) {
  if (value === 0) {
    // If brightness is set to 0, turn off the bulb
    this.log("[%s] Setting brightness to 0 (off)", this.name);
    this.lightbulbService.setCharacteristic(Characteristic.On, false);
  } else if (value <= 5 && this.type !== "rgb") {
    // If setting brightness to 5 or lower, instead set night mode for bulbs that support it
    this.log("[%s] Setting night mode", this.name);

    this.bridge.sendCommands(this.commands[this.type].off(this.zone));
    // Ensure we're pausing for 100ms between these commands as per the spec
    this.bridge.pause(100);
    this.bridge.sendCommands(this.commands[this.type].nightMode(this.zone));

    // Manually clear last bulb sent so that "on" is sent when we next interact with this bulb
    this.bridge.lastSent = "";

  } else {
    // Send on command to ensure we're addressing the right bulb
    this.lightbulbService.setCharacteristic(Characteristic.On, true);

    this.log("[%s] Setting brightness to %s", this.name, value);

    // If bulb supports it, set the absolute brightness specified
    if (["rgb", "white"].indexOf(this.type) === -1) {
      if (this.bridge.version === "v6" && this.type !== "bridge") {
        this.bridge.sendCommands(this.commands[this.type].brightness(this.zone, value));
      } else {
        this.bridge.sendCommands(this.commands[this.type].brightness(value));
      }
    } else {
      // If this is an rgb or a white bulb, they only support brightness up and down.
      if (this.type === "white" && value === 100) {
        // But the white bulbs do have a "maximum brightness" command
        this.bridge.sendCommands(this.commands[this.type].maxBright(this.zone));
      } else {
        // We're going to send the number of brightness up or down commands required to get to get from
        // the current value that HomeKit knows to the target value

        const currentLevel = this.state.Brightness;

        let targetDiff = value - currentLevel;
        const targetDirection = Math.sign(targetDiff);
        targetDiff = Math.max(0, (Math.round(Math.abs(targetDiff) / 10))); // There are 10 steps of brightness

        if (targetDirection === 0 || targetDiff === 0) {
          this.log("[%s] Brightness change not large enough to move to next step for bulb", this.name);

          // Don't change the internal value since we didn't make any change
          value = currentLevel;
        } else {
          this.log.debug("[%s] Setting brightness to internal value %d (%d steps away)", this.name, Math.round(currentLevel / 10), targetDiff);

          for (; targetDiff > 0; targetDiff--) {
            if (targetDirection === 1) {
              this.bridge.sendCommands(this.commands[this.type].brightUp(this.zone));
              this.log.debug("[%s] Sending brightness up command", this.name);
            } else if (targetDirection === -1) {
              this.bridge.sendCommands(this.commands[this.type].brightDown(this.zone));
              this.log.debug("[%s] Sending brightness down command", this.name);
            }
          }
        }
      }
    }
  }

  callback();

  return value;
};

MiLightAccessory.prototype.setHue = function(value, callback) {
  // Send on command to ensure we're addressing the right bulb
  this.lightbulbService.setCharacteristic(Characteristic.On, true);

  this.log("[%s] Setting hue to %s", this.name, value);

  this.swapBrightnessValues(true);

  if (this.bridge.version === "v6" && this.type !== "bridge") {
    this.bridge.sendCommands(this.commands[this.type].hue(this.zone, MilightHelper.hsvToMilightColor([value, 0, 0]), true));
  } else {
    this.bridge.sendCommands(this.commands[this.type].hue(MilightHelper.hsvToMilightColor([value, 0, 0]), true));
  }

  callback();

  return value;
};

MiLightAccessory.prototype.setSaturation = function(value, callback) {
  if (["rgbw", "bridge", "fullColor", "fullColor8Zone"].indexOf(this.type) > -1) {
    if (value === 0) {
      // Send on command to ensure we're addressing the right bulb
      this.lightbulbService.setCharacteristic(Characteristic.On, true);

      this.log("[%s] Saturation set to 0, setting bulb to white", this.name);

      this.swapBrightnessValues(false);

      // If this is a fullColor bulb, set the colour temperature to the last stored value, else (rgbw or bridge) just set to white mode
      if (["fullColor", "fullColor8Zone"].indexOf(this.type) > -1) {
        this.setColorTemperature(this.lightbulbService.getCharacteristic(Characteristic.ColorTemperature).value, function() {});
      } else {
        this.bridge.sendCommands(this.commands[this.type].whiteMode(this.zone));
      }
    } else if (["fullColor", "fullColor8Zone"].indexOf(this.type) > -1) {
      // Send on command to ensure we're addressing the right bulb
      this.lightbulbService.setCharacteristic(Characteristic.On, true);

      this.log("[%s] Setting saturation to %s", this.name, value);

      this.bridge.sendCommands(this.commands[this.type].saturation(this.zone, value, true));
    } else {
      this.log("[%s] Saturation set to non-zero value %d, setting bulb %s bulb back to colour mode", this.name, value, this.type);
      this.setHue(this.lightbulbService.getCharacteristic(Characteristic.Hue).value, function() {});
    }
  } else {
    this.log.info("[%s] Setting saturation to %s (NOTE: No impact on %s %s bulbs)", this.name, value, this.type, this.log.prefix);
  }

  callback();

  return value;
};

MiLightAccessory.prototype.setColorTemperature = function(value, callback) {
  if (["fullColor", "fullColor8Zone"].indexOf(this.type) > -1) {
    // Send on command to ensure we're addressing the right bulb
    this.lightbulbService.setCharacteristic(Characteristic.On, true);

    this.log("[%s] Setting color temperature to %sK", this.name, Math.round(1000000 / value));

    // There are only 100 steps of color temperature for fullColor bulbs, so let's convert from megakelvin to a value from 0-100
    const miLightValue = this.mkToMilight(value, 100);

    this.swapBrightnessValues(false);

    this.log.debug("[%s] Setting bulb color temperature to internal value %s", this.name, miLightValue);

    this.bridge.sendCommands(this.commands[this.type].whiteTemperature(this.zone, miLightValue));
  } else if (this.type === "white") {
    // Send on command to ensure we're addressing the right bulb
    this.lightbulbService.setCharacteristic(Characteristic.On, true);

    // White bulbs don't support setting an absolue colour temp, so we'll do some math to figure out how to get there
    const currentLevel = this.state.ColorTemperature;

    let targetDiff = this.mkToMilight(currentLevel, 10) - this.mkToMilight(value, 10);
    const targetDirection = Math.sign(targetDiff);
    targetDiff = Math.abs(targetDiff);

    if (targetDirection === 0 || targetDiff === 0) {
      this.log("[%s] Change not large enough to move to next step for bulb", this.name);

      // Don't change the internal value since we didn't make any change
      value = currentLevel;
    } else {
      this.log("[%s] Setting color temperature to %sK", this.name, Math.round(1000000 / value));

      this.log.debug("[%s] Setting bulb color temperature to internal value %d (%d steps away)", this.name, this.mkToMilight(value, 10), targetDiff);

      for (; targetDiff > 0; targetDiff--) {
        if (targetDirection === -1) {
          this.bridge.sendCommands(this.commands[this.type].cooler(this.zone));
          this.log.debug("[%s] Sending bulb cooler command", this.name);
        } else if (targetDirection === 1) {
          this.bridge.sendCommands(this.commands[this.type].warmer(this.zone));
          this.log.debug("[%s] Sending bulb warmer command", this.name);
        }
      }
    }
  }

  callback();

  return value;
};

MiLightAccessory.prototype.mkToMilight = function(mk, scale) {
  const props = this.lightbulbService.getCharacteristic(Characteristic.ColorTemperature).props;

  return Math.max(0, Math.abs((Math.round(Math.abs(mk - props.minValue) / ((props.maxValue - props.minValue) / scale))) - scale));
};

MiLightAccessory.prototype.swapBrightnessValues = function(mode) {
  if (this.state.colorMode) {
    this.state.colorBrightness = this.lightbulbService.getCharacteristic(Characteristic.Brightness).value;
  } else {
    this.state.whiteBrightness = this.lightbulbService.getCharacteristic(Characteristic.Brightness).value;
  }

  this.state.colorMode = mode;

  // Update the cached brightness value to the one for the mode we're switching in to
  this.lightbulbService.updateCharacteristic(Characteristic.Brightness, this.state.colorMode ? this.state.colorBrightness : this.state.whiteBrightness);
};

MiLightAccessory.prototype.updateBulb = function() {
  for (const characteristic in this.state) {
    if (this.lightbulbService.testCharacteristic(Characteristic[characteristic]) && (this.state[characteristic] !== this.lightbulbService.getCharacteristic(Characteristic[characteristic]).value) || characteristic === "On") {
      if (characteristic === "On" && this.lightbulbService.getCharacteristic(Characteristic.Brightness).value <= 5 && this.type !== "rgb") {
        this.state[characteristic] = this.lightbulbService.getCharacteristic(Characteristic[characteristic]).value;
        this.log.debug("[%s] Bulb to be set to night mode, avoiding sending 'on' command", this.name);
        continue;
      }
      if (characteristic === "Hue" && this.lightbulbService.getCharacteristic(Characteristic.Saturation).value === 0) {
        this.state[characteristic] = this.lightbulbService.getCharacteristic(Characteristic[characteristic]).value;
        this.log.debug("[%s] Not setting bulb hue to %d as we've already put the bulb in white mode (saturation == 0)", this.name, this.state[characteristic]);
        continue;
      } else if (characteristic === "Hue" && this.lightbulbService.getCharacteristic(Characteristic.Saturation).value !== 0) {
        // noop
      }

      const setFunction = "set" + characteristic;

      // We're storing some non-characteristic values in the state var now, check to see if we can actually set them
      if (typeof this[setFunction] === "function") {
        this.state[characteristic] = this[setFunction](this.lightbulbService.getCharacteristic(Characteristic[characteristic]).value, function() {});
      }
    }
  }
};

MiLightAccessory.prototype.update = function(characteristic, value, callback) {
  this.log.debug("[%s] Queueing value %s for characteristic %s", this.name, value, characteristic);

  // All "set" events now trigger this function, which calls the debounced function `updateBulb`
  // which goes through and sends commands after the debounce timeout.
  // This should allow for the correct ordering of commands and simplifies some logic
  this.debounceUpdateBulb();

  callback();
};

MiLightAccessory.prototype.identify = function(callback) {
  this.log("[%s] Identify requested!", this.name);

  callback(); // success
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
    .on("set", this.update.bind(this, "On"));

  this.lightbulbService
    .addCharacteristic(new Characteristic.Brightness())
    .on("set", this.update.bind(this, "Brightness"));

  if (["fullColor", "fullColor8Zone", "rgbw", "rgb", "bridge"].indexOf(this.type) > -1) {
    this.lightbulbService
      .addCharacteristic(new Characteristic.Saturation())
      .on("set", this.update.bind(this, "Saturation"));

    this.lightbulbService
      .addCharacteristic(new Characteristic.Hue())
      .on("set", this.update.bind(this, "Hue"));
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
      .on("set", this.update.bind(this, "ColorTemperature"));
  }

  return [this.informationService, this.lightbulbService];
};
