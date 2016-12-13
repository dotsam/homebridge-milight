var Milight = require("node-milight-promise").MilightController;
var commands = require("node-milight-promise").commands;

"use strict";

var Service, Characteristic;

module.exports = function (homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerPlatform("homebridge-milight", "MiLight", MiLightPlatform);
};

function MiLightPlatform(log, config) {
  this.log = log;
  this.config = config;
}

MiLightPlatform.prototype.accessories = function (callback) {
  var foundZones = [];

  if (this.config.bridges) {
    if (this.config.zones) {
      this.log.warn("Bridges and Zones keys detected in config. Only using bridges config.");
    }

    if (this.config.bridges.length === 0) {
      throw new Error("No bridges found in configuration.");
    } else {
      for (var i = 0; i < this.config.bridges.length; i++) {
        if ( !this.config.bridges[i]) {
          var returnedZones = this._addLamps(this.config.bridges[i]);
          foundZones.push.apply(foundZones, returnedZones);
        }
      }
    }

  } else if (this.config.zones) {
    this.log.warn("DEPRECATED: See README for details of setting zones in new bridges key.");
    foundZones = this._addLamps(this.config);
  } else {
    throw new Error("Could not read any zones/bridges from configuration.");
  }

  if (foundZones.length > 0) {
    callback(foundZones);
  } else {
    throw new Error("Unable to find any valid zones.");
  }

};

MiLightPlatform.prototype._addLamps = function (bridgeConfig) {
  var zones = [];
  var zonesLength;

  // Various error checking
  if (bridgeConfig.zones) {
    zonesLength = bridgeConfig.zones.length;
  } else {
    throw new Error("Could not read zones from configuration.");
  }

  if (!bridgeConfig.type) {
    this.log("INFO: Type not specified, defaulting to rgbw");
    bridgeConfig.type = "rgbw";
  }

  if (zonesLength === 0) {
    throw new Error("No zones found in configuration.");
  } else if (bridgeConfig.type == "rgb" && zonesLength > 1) {
    this.log("WARNING: RGB lamps only have a single zone. Only the first defined zone will be used.");
    zonesLength = 1;
  } else if (zonesLength > 4) {
    this.log("WARNING: Only a maximum of 4 zones are supported per bridge. Only recognizing the first 4 zones.");
    zonesLength = 4;
  }

  // Initialize a new controller to be used for all zones defined for this bridge
  var bridgeController = new Milight({
    ip: bridgeConfig.ip_address,
    port: bridgeConfig.port,
    delayBetweenCommands: bridgeConfig.delay,
    commandRepeat: bridgeConfig.repeat
  });

  // Create lamp accessories for all of the defined zones
  for (var i = 0; i < zonesLength; i++) {
    if ( !bridgeConfig.zones[i]) {
      bridgeConfig.name = bridgeConfig.zones[i];
      bridgeConfig.zone = i + 1;
      var lamp = new MiLightAccessory(this.log, bridgeConfig, bridgeController);
      zones.push(lamp);
    }
  }

  return zones;
};

function MiLightAccessory(log, lampConfig, lampController) {
  this.log = log;

  // config info
  this.name = lampConfig.name;
  this.zone = lampConfig.zone;
  this.type = lampConfig.type;

  // assign to the bridge
  this.light = lampController;

}

MiLightAccessory.prototype.setPowerState = function (powerOn, callback) {
  if (powerOn) {
    this.log("[" + this.name + "] Setting power state to on");
    this.light.sendCommands(commands[this.type].on(this.zone));
  } else {
    this.log("[" + this.name + "] Setting power state to off");
    this.light.sendCommands(commands[this.type].off(this.zone));
  }
  callback(null);
};

MiLightAccessory.prototype.setBrightness = function (level, callback) {
  if (level === 0) {
    // If brightness is set to 0, turn off the lamp
    this.log("[" + this.name + "] Setting brightness to 0 (off)");
    this.lightbulbService.setCharacteristic(Characteristic.On, false);
  } else if (level <= 5 && (this.type == "rgbw" || this.type == "white")) {
    // If setting brightness to 5 or lower, instead set night mode for lamps that support it
    this.log("[" + this.name + "] Setting night mode");

    this.light.sendCommands(commands[this.type].off(this.zone));
    // Ensure we're pausing for 100ms between these commands as per the spec
    this.light.pause(100);
    this.light.sendCommands(commands[this.type].nightMode(this.zone));

  } else {
    // Send on command to ensure we're addressing the right bulb
    this.lightbulbService.setCharacteristic(Characteristic.On, 1);

    this.log("[" + this.name + "] Setting brightness to %s", level);

    // If this is an rgbw lamp, set the absolute brightness specified
    if (this.type == "rgbw") {
      // Compress down the scale to account for setting night mode at brightness 1-5%
      this.light.sendCommands(commands.rgbw.brightness(level - 4));
    } else {
      // If this is an rgb or a white lamp, they only support brightness up and down.
      // Set brightness up when value is >50 and down otherwise. Not sure how well this works real-world.
      if (level >= 50) {
        if (this.type == "white" && level == 100) {
          // But the white lamps do have a "maximum brightness" command
          this.light.sendCommands(commands.white.maxBright(this.zone));
        } else {
          this.light.sendCommands(commands[this.type].brightUp());
        }
      } else {
        this.light.sendCommands(commands[this.type].brightDown());
      }
    }
  }
  callback(null);
};

MiLightAccessory.prototype.setHue = function (value, callback) {
  // Send on command to ensure we're addressing the right bulb
  this.lightbulbService.setCharacteristic(Characteristic.On, true);

  this.log("[" + this.name + "] Setting hue to %s", value);

  var hue = Array(value, 0, 0);

  if (this.type == "rgbw") {
    if (this.lightbulbService.getCharacteristic(Characteristic.Saturation).value === 0) {
      this.log("[" + this.name + "] Saturation is 0, making sure bulb is in white mode");
      this.light.sendCommands(commands.rgbw.whiteMode(this.zone));
    } else {
      this.light.sendCommands(commands.rgbw.hue(commands.rgbw.hsvToMilightColor(hue)));
    }
  } else if (this.type == "rgb") {
    this.light.sendCommands(commands.rgb.hue(commands.rgbw.hsvToMilightColor(hue)));
  } else if (this.type == "white") {
    // Again, white lamps don't support setting an absolue colour temp, so trying to do warmer/cooler step at a time based on colour
    if (value >= 180) {
      this.light.sendCommands(commands.white.cooler());
    } else {
      this.light.sendCommands(commands.white.warmer());
    }
  }
  callback(null);
};

MiLightAccessory.prototype.setSaturation = function (value, callback) {
  if (this.type == "rgbw") {
    // Send on command to ensure we're addressing the right bulb
    this.lightbulbService.setCharacteristic(Characteristic.On, true);

    if (value === 0) {
      this.log("[" + this.name + "] Saturation set to 0, setting bulb to white");
      this.light.sendCommands(commands.rgbw.whiteMode(this.zone));
    } else if (this.lightbulbService.getCharacteristic(Characteristic.Hue).value === 0) {
      this.log("[" + this.name + "] Saturation set to %s, but hue is not 0, resetting hue", value);
      this.light.sendCommands(commands.rgbw.hue(commands.rgbw.hsvToMilightColor(Array(this.lightbulbService.getCharacteristic(Characteristic.Hue).value, 0, 0))));
    } else {
      this.log("[" + this.name + "] Setting saturation to %s (NOTE: No impact on %s %s bulbs)", value, this.type, this.log.prefix);
    }
  } else {
    this.log("[" + this.name + "] Setting saturation to %s (NOTE: No impact on %s %s bulbs)", value, this.type, this.log.prefix);
  }
  callback(null);
};

MiLightAccessory.prototype.identify = function (callback) {
  this.log("[" + this.name + "] Identify requested!");
  callback(null); // success
};

MiLightAccessory.prototype.getServices = function () {
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

  this.lightbulbService
    .addCharacteristic(new Characteristic.Saturation())
    .on("set", this.setSaturation.bind(this));

  this.lightbulbService
    .addCharacteristic(new Characteristic.Hue())
    .on("set", this.setHue.bind(this));

  return [this.informationService, this.lightbulbService];
};
