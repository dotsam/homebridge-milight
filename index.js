var Milight = require("node-milight-promise").MilightController;
var helper = require("node-milight-promise").helper;
var inherits = require('util').inherits;

"use strict";

var Service, Characteristic;

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  // Define the standard HomeKit color temperature characteristic until it's in HAP-NodeJS
  Characteristic.ColorTemperature = function() {
    Characteristic.call(this, 'Color Temperature', '000000CE-0000-1000-8000-0026BB765291');
    this.setProps({
      format: Characteristic.Formats.UINT32,
      unit: "mired",
      maxValue: 370,
      minValue: 153,
      minStep: 1,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
    });
    // maxValue 370 = 2700K (1000000/2700)
    // minValue 153 = 6500K (1000000/6500)
    this.value = this.getDefaultValue();
  };
  inherits(Characteristic.ColorTemperature, Characteristic);

  homebridge.registerPlatform("homebridge-milight", "MiLight", MiLightPlatform);
};

function MiLightPlatform(log, config) {
  this.log = log;
  this.config = config;
}

MiLightPlatform.prototype.accessories = function(callback) {
  var foundBulbs = [];
  var bridgeControllers = {};

  if (this.config.bridges.length > 0) {
    for (var bridgeConfig of this.config.bridges) {
      if (bridgeConfig.lights && Object.keys(bridgeConfig.lights).length > 0) {

        // Setting appropriate commands per bridge version. Defaults to v2 as those are the commands that previous versions of the plugin used
        if (!bridgeConfig.version) {
          bridgeConfig.version = "v2";
        }

        for (var lightType in bridgeConfig.lights) {
          if (["fullColor", "rgbw", "rgb", "white", "bridge"].indexOf(lightType) === -1) {
            this.log.error("Invalid bulb type '%s' specified.", lightType);
          } else if (bridgeConfig.version !== "v6" && ["fullColor", "bridge"].indexOf(lightType) > -1) {
            this.log.error("Bulb type '%s' only avaliable with v6 bridge!", lightType);
          } else {
            var zonesLength = bridgeConfig.lights[lightType].length;

            if (zonesLength < 1) {
              this.log.error("No bulbs found in '%s' configuration.", lightType);
              zonesLength = 0;
            } else if (["rgb", "bridge"].indexOf(lightType) > -1 && zonesLength > 1) {
              this.log.warn("Bulb type '%s' only supports a single zone. Only the first defined bulb will be used.", lightType);
              zonesLength = 1;
            } else if (zonesLength > 4) {
              this.log.warn("Only a maximum of 4 zones per bulb type are supported per bridge. Only recognizing the first 4 zones.");
              zonesLength = 4;
            }

            if (zonesLength > 0) {
              // If it hasn't been already, initialize a new controller to be used for all zones defined for this bridge
              if (typeof(bridgeControllers[bridgeConfig.ip_address]) != "object") {
                bridgeControllers[bridgeConfig.ip_address] = new Milight({
                  ip: bridgeConfig.ip_address,
                  port: bridgeConfig.port,
                  delayBetweenCommands: bridgeConfig.delay,
                  commandRepeat: bridgeConfig.repeat,
                  type: bridgeConfig.version
                });

                // Attach the right commands to the bridgeController object
                if (bridgeConfig.version === "v6") {
                  bridgeControllers[bridgeConfig.ip_address].commands = require("node-milight-promise").commandsV6;
                } else if (bridgeConfig.version === "v3") {
                  bridgeControllers[bridgeConfig.ip_address].commands = require("node-milight-promise").commands2;
                } else {
                  bridgeControllers[bridgeConfig.ip_address].commands = require("node-milight-promise").commands;
                }

                // Used to keep track of the last targeted bulb
                bridgeControllers[bridgeConfig.ip_address].lastSent = {
                  bulb: ''
                };
              }

              // Create bulb accessories for all of the defined zones
              for (var i = 0; i < zonesLength; i++) {
                var bulbConfig = {};
                if (bulbConfig.name = bridgeConfig.lights[lightType][i]) {
                  bulbConfig.type = lightType;
                  bulbConfig.zone = i + 1;
                  var bulb = new MiLightAccessory(bulbConfig, bridgeControllers[bridgeConfig.ip_address], this.log);
                  foundBulbs.push(bulb);
                } else if (bridgeConfig.lights[lightType][i] !== null) {
                  this.log.error("Unable to add light from '%s' array, index %d", lightType, i);
                }
              }
            }
          }
        }
      } else {
        this.log.error("Could not read any lights from bridge %s", bridgeConfig.ip_address);
      }
    }
  } else {
    this.log.error("No bridges defined.")
  }

  if (foundBulbs.length <= 0) {
    this.log.error("No valid bulbs found in any bridge.");
  }

  callback(foundBulbs);
};

function MiLightAccessory(bulbConfig, bridgeController, log) {
  this.log = log;

  // config info
  this.name = bulbConfig.name;
  this.zone = bulbConfig.zone;
  this.type = bulbConfig.type;

  // have to keep track of the last values we set brightness and colour temp to for rgb/white bulbs
  this.brightness = -1;
  this.hue = -1;
  this.ct = -1;

  // assign to the bridge
  this.light = bridgeController;

  // set the version from the bridge
  this.version = this.light.type;

  // use the right commands for this bridge
  this.commands = this.light.commands;

  // keep track of the last bulb an 'on' command was sent to
  this.lastSent = this.light.lastSent;

}

MiLightAccessory.prototype.setPowerState = function(powerOn, callback) {
  if (powerOn) {
    if (this.lastSent.bulb === this.type + this.zone) {
      this.log.debug("[" + this.name + "] Ommiting 'on' command as we've sent it to this bulb most recently");
    } else {
      this.log("[" + this.name + "] Setting power state to on");
      this.lastSent.bulb = this.type + this.zone;
      this.light.sendCommands(this.commands[this.type].on(this.zone));
    }
  } else {
    this.log("[" + this.name + "] Setting power state to off");
    this.lastSent.bulb = '';
    this.light.sendCommands(this.commands[this.type].off(this.zone));
  }
  callback(null);
};

MiLightAccessory.prototype.setBrightness = function(level, callback) {
  if (level === 0) {
    // If brightness is set to 0, turn off the bulb
    this.log("[" + this.name + "] Setting brightness to 0 (off)");
    this.lightbulbService.setCharacteristic(Characteristic.On, false);
  } else if (level <= 5 && this.type !== "rgb") {
    // If setting brightness to 5 or lower, instead set night mode for bulbs that support it
    this.log("[" + this.name + "] Setting night mode");

    this.light.sendCommands(this.commands[this.type].off(this.zone));
    // Ensure we're pausing for 100ms between these commands as per the spec
    this.light.pause(100);
    this.light.sendCommands(this.commands[this.type].nightMode(this.zone));

  } else {
    // Send on command to ensure we're addressing the right bulb
    this.lightbulbService.setCharacteristic(Characteristic.On, true);

    this.log("[" + this.name + "] Setting brightness to %s", level);

    // If bulb supports it, set the absolute brightness specified
    if (["rgb", "white"].indexOf(this.type) === -1) {
      if (this.version === "v6" && this.type !== "bridge") {
        this.light.sendCommands(this.commands[this.type].brightness(this.zone, level));
      } else {
        this.light.sendCommands(this.commands[this.type].brightness(level));
      }
    } else {
      // If this is an rgb or a white bulb, they only support brightness up and down.
      if (this.type === "white" && level === 100) {
        // But the white bulbs do have a "maximum brightness" command
        this.light.sendCommands(this.commands[this.type].maxBright(this.zone));
        this.brightness = 100;
      } else {
        // We're going to send the number of brightness up or down commands required to get to get from
        // the current value that HomeKit knows to the target value

        // Keeping track of the value separately from Homebridge so we know when to change across multiple small adjustments
        if (this.brightness === -1) this.brightness = this.lightbulbService.getCharacteristic(Characteristic.Brightness).value;
        var currentLevel = this.brightness;

        var targetLevel = level - currentLevel;
        var targetDirection = Math.sign(targetLevel);
        targetLevel = Math.max(0, (Math.round(Math.abs(targetLevel) / 10))); // There are 10 steps of brightness

        if (targetDirection === 0 || targetDirection === -0 || targetLevel === 0) {
          this.log("[" + this.name + "] Change not large enough to move to next step for bulb");
        } else {
          this.brightness = level;

          for (; targetLevel !== 0; targetLevel--) {
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
  callback(null);
};

MiLightAccessory.prototype.setHue = function(value, callback, context) {
  // Send on command to ensure we're addressing the right bulb
  this.lightbulbService.setCharacteristic(Characteristic.On, true);

  this.log("[" + this.name + "] Setting hue to %s", value);

  if (["fullColor", "rgbw", "bridge"].indexOf(this.type) > -1 && this.lightbulbService.getCharacteristic(Characteristic.Saturation).value === 0 && this.hue !== -1 && context !== 'internal') {
    this.log("[" + this.name + "] Saturation is 0, making sure bulb is in white mode");
    this.light.sendCommands(this.commands[this.type].whiteMode(this.zone));
  } else if (this.type !== "white") {
    this.hue = value;

    if (this.version === "v6" && this.type !== "bridge") {
      this.light.sendCommands(this.commands[this.type].hue(this.zone, helper.hsvToMilightColor([value, 0, 0]), true));
    } else {
      this.light.sendCommands(this.commands[this.type].hue(helper.hsvToMilightColor([value, 0, 0]), true));
    }
  }
  callback(null);
};

MiLightAccessory.prototype.setSaturation = function(value, callback) {
  if (["rgbw", "bridge", "fullColor"].indexOf(this.type) > -1) {
    if (value === 0) {
      // Send on command to ensure we're addressing the right bulb
      this.lightbulbService.setCharacteristic(Characteristic.On, true);

      this.log("[" + this.name + "] Saturation set to 0, setting bulb to white");
      this.light.sendCommands(this.commands[this.type].whiteMode(this.zone));
    } else if (this.type === "fullColor") {
      // Send on command to ensure we're addressing the right bulb
      this.lightbulbService.setCharacteristic(Characteristic.On, true);

      this.log("[" + this.name + "] Setting saturation to %s", value);

      this.light.sendCommands(this.commands[this.type].saturation(this.zone, value, true));
    } else {
      // We can get these commands out-of-order, so set the hue again just to be sure
      this.log.info("[" + this.name + "] Saturation set to %s, but hue is not 0, resetting hue", value);
      this.lightbulbService.getCharacteristic(Characteristic.Hue).setValue(this.lightbulbService.getCharacteristic(Characteristic.Hue).value, null, 'internal');
    }
  } else {
    this.log.info("[" + this.name + "] Setting saturation to %s (NOTE: No impact on %s %s bulbs)", value, this.type, this.log.prefix);
  }
  callback(null);
};

MiLightAccessory.prototype.setColorTemperature = function(value, callback) {
  if (this.type === "fullColor") {
    // Send on command to ensure we're addressing the right bulb
    this.lightbulbService.setCharacteristic(Characteristic.On, true);

    this.log("[" + this.name + "] Setting color temperature to %sK", 1000000 / value);

    var props = this.lightbulbService.getCharacteristic(Characteristic.ColorTemperature).props;

    // There are only 100 steps of color temperature for fullColor bulbs, so let's convert from megakelvin to a value from 0-100
    value = Math.max(0, (Math.round(Math.abs(value - props.minValue) / ((props.maxValue - props.minValue) / 100))));

    this.light.sendCommands(this.commands[this.type].whiteTemperature(this.zone, value));
  } else if (this.type === "white") {
    // Send on command to ensure we're addressing the right bulb
    this.lightbulbService.setCharacteristic(Characteristic.On, true);

    // White bulbs don't support setting an absolue colour temp, so we'll do some math to figure out how to get there

    // Keeping track of the value separately from Homebridge so we know when to change across multiple small adjustments
    if (this.ct === -1) this.ct = this.lightbulbService.getCharacteristic(Characteristic.ColorTemperature).value;
    var currentLevel = this.ct;

    var targetLevel = value - currentLevel;
    var targetDirection = Math.sign(targetLevel);

    var props = this.lightbulbService.getCharacteristic(Characteristic.ColorTemperature).props;

    // There are only 10 steps of color temperature for white bulbs, so let's convert from megakelvin to a value from 1-10
    targetLevel = Math.max(0, (Math.round(Math.abs(targetLevel - props.minValue) / ((props.maxValue - props.minValue) / 10))));

    if (targetDirection === 0 || targetDirection === -0 || targetLevel === 0) {
      this.log("[" + this.name + "] Change not large enough to move to next step for bulb");
    } else {
      this.ct = value;

      for (; targetLevel !== 0; targetLevel--) {
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
    .on("set", this.setPowerState.bind(this));

  this.lightbulbService
    .addCharacteristic(new Characteristic.Brightness())
    .on("set", this.setBrightness.bind(this));

  if (["fullColor", "rgbw", "rgb", "bridge"].indexOf(this.type) > -1) {
    this.lightbulbService
      .addCharacteristic(new Characteristic.Saturation())
      .on("set", this.setSaturation.bind(this));

    this.lightbulbService
      .addCharacteristic(new Characteristic.Hue())
      .on("set", this.setHue.bind(this));
  }

  if (["fullColor", "white"].indexOf(this.type) > -1) {
    this.lightbulbService
      .addCharacteristic(new Characteristic.ColorTemperature())
      .on("set", this.setColorTemperature.bind(this));
  }

  return [this.informationService, this.lightbulbService];
};
