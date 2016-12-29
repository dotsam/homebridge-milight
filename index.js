var Milight = require("node-milight-promise").MilightController;
var helper = require("node-milight-promise").helper;

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
      this.log.error("No bridges found in configuration.");
    } else {
      for (var i = 0; i < this.config.bridges.length; i++) {
        if (this.config.bridges[i]) {
          var returnedZones = this._addLamps(this.config.bridges[i]);
          Array.prototype.push.apply(foundZones, returnedZones);
        }
      }
    }

  } else if (this.config.zones) {
    this.log.warn("DEPRECATED: See README for details of setting zones in new bridges key.");
    foundZones = this._addLamps(this.config);
  } else {
    this.log.error("Could not read any zones/bridges from configuration.");
  }

  if (foundZones.length > 0) {
    callback(foundZones);
  } else {
    this.log.error("Unable to find any valid zones.");
  }

};

MiLightPlatform.prototype._addLamps = function (bridgeConfig) {
  var zones = [];
  var zonesLength = 0;

  // Various error checking
  if (bridgeConfig.zones) {
    zonesLength = bridgeConfig.zones.length;
  } else {
    this.log.error("Could not read zones from configuration.");
  }

  if (!bridgeConfig.type || ['fullColor', 'rgbw', 'rgb', 'white'].indexOf(bridgeConfig.type) === -1) {
    this.log.warning("Type not specified or invalid type, defaulting to rgbw");
    bridgeConfig.type = "rgbw";
  }

  if (zonesLength === 0) {
    this.log.error("No zones found in configuration.");
  } else if (bridgeConfig.type === "rgb" && zonesLength > 1) {
    this.log.warning("RGB lamps only have a single zone. Only the first defined zone will be used.");
    zonesLength = 1;
  } else if (zonesLength > 4) {
    this.log.warning("Only a maximum of 4 zones are supported per bridge. Only recognizing the first 4 zones.");
    zonesLength = 4;
  }
  
  if (!bridgeConfig.hasOwnProperty('version')) {
    bridgeConfig.version = "v3";
  }
  
  if (bridgeConfig.version !== "v6" && bridgeConfig.type === "fullColor") {
    this.log.error("Full colour bulbs only avaliable with v6 bridge!");
  }
  
  if (bridgeConfig.version === "v6") {
    bridgeConfig.commands = require("node-milight-promise").commandsV6;
  } else if (bridgeConfig.version === "v5") {
    bridgeConfig.commands = require("node-milight-promise").commands2;
  } else {
    bridgeConfig.commands = require("node-milight-promise").commands;
  }

  // Initialize a new controller to be used for all zones defined for this bridge
  var bridgeController = new Milight({
    ip: bridgeConfig.ip_address,
    port: bridgeConfig.port,
    delayBetweenCommands: bridgeConfig.delay,
    commandRepeat: bridgeConfig.repeat,
    type: bridgeConfig.version
  });

  // Create lamp accessories for all of the defined zones
  for (var i = 0; i < zonesLength; i++) {
    if (bridgeConfig.zones[i]) {
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
  this.version = lampConfig.version;
  
  // have to keep track of the last values we set brightness and colour temp to for rgb/white bulbs
  this.brightness = -1;
  this.hue = -1;

  // assign to the bridge
  this.light = lampController;
  
  // use the right commands for this bridge
  this.commands = lampConfig.commands;

}

MiLightAccessory.prototype.setPowerState = function (powerOn, callback) {
  if (powerOn) {
    this.log("[" + this.name + "] Setting power state to on");
    this.light.sendCommands(this.commands[this.type].on(this.zone));
  } else {
    this.log("[" + this.name + "] Setting power state to off");
    this.light.sendCommands(this.commands[this.type].off(this.zone));
  }
  callback(null);
};

MiLightAccessory.prototype.setBrightness = function (level, callback) {
  if (level === 0) {
    // If brightness is set to 0, turn off the lamp
    this.log("[" + this.name + "] Setting brightness to 0 (off)");
    this.lightbulbService.setCharacteristic(Characteristic.On, false);
  } else if (level <= 5 && (this.type === "rgbw" || this.type === "white" || this.type === "fullColor")) {
    // If setting brightness to 5 or lower, instead set night mode for lamps that support it
    this.log("[" + this.name + "] Setting night mode");

    this.light.sendCommands(this.commands[this.type].off(this.zone));
    // Ensure we're pausing for 100ms between these commands as per the spec
    this.light.pause(100);
    this.light.sendCommands(this.commands[this.type].nightMode(this.zone));

  } else {
    // Send on command to ensure we're addressing the right bulb
    this.lightbulbService.setCharacteristic(Characteristic.On, true);

    this.log("[" + this.name + "] Setting brightness to %s", level);

    // If this is an rgbw lamp, set the absolute brightness specified
    if (this.type === "rgbw" || this.type === "fullColor") {
      if (this.version === "v6") {
        this.light.sendCommands(this.commands[this.type].brightness(this.zone, level));
      } else {
        this.light.sendCommands(this.commands[this.type].brightness(level));
      }
    } else {      
      // If this is an rgb or a white lamp, they only support brightness up and down.
      if (this.type === "white" && level === 100) {
        // But the white lamps do have a "maximum brightness" command
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
        targetLevel = Math.max(0,(Math.round(Math.abs(targetLevel)/10))); // There are 10 steps of brightness
          
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

MiLightAccessory.prototype.setHue = function (value, callback) {
  // Send on command to ensure we're addressing the right bulb
  this.lightbulbService.setCharacteristic(Characteristic.On, true);

  this.log("[" + this.name + "] Setting hue to %s", value);

  var hue = [value, 0, 0];

  if (this.type === "rgbw" || this.type === "fullColor") {
    if (this.lightbulbService.getCharacteristic(Characteristic.Saturation).value === 0 && this.hue !== -1) {
      this.log("[" + this.name + "] Saturation is 0, making sure bulb is in white mode");
      this.light.sendCommands(this.commands[this.type].whiteMode(this.zone));
    } else {
      this.hue = value;
      
      if (this.version === "v6") {
        this.light.sendCommands(this.commands[this.type].hue(this.zone, helper.hsvToMilightColor(hue), true));
      } else {
        this.light.sendCommands(this.commands[this.type].hue(helper.hsvToMilightColor(hue)));
      }
    }
  } else if (this.type === "rgb") {
    if (this.version === "v6") {
      this.light.sendCommands(this.commands[this.type].hue(this.zone, helper.hsvToMilightColor(hue), true));
    } else {
      this.light.sendCommands(this.commands[this.type].hue(helper.hsvToMilightColor(hue)));
    }
  } else if (this.type === "white") {
    // Again, white lamps don't support setting an absolue colour temp, so we'll do some math to figure out how to get there
    
    // Keeping track of the value separately from Homebridge so we know when to change across multiple small adjustments
    if (this.hue === -1) this.hue = this.lightbulbService.getCharacteristic(Characteristic.Hue).value;
    var currentLevel = this.hue;
    
    var targetLevel = value - currentLevel;
    var targetDirection = Math.sign(targetLevel);
    targetLevel = Math.max(0,(Math.round(Math.abs(targetLevel)/36))); // There are 10 steps of colour temp (360/10)
      
    if (targetDirection === 0 || targetDirection === -0 || targetLevel === 0) {
      this.log("[" + this.name + "] Change not large enough to move to next step for bulb");
    } else {
      this.hue = value;
      
      for (; targetLevel !== 0; targetLevel--) {
        if (targetDirection === 1) {
          this.light.sendCommands(this.commands[this.type].cooler(this.zone));
          this.log.debug("[" + this.name + "] Sending bulb cooler command");
        } else if (targetDirection === -1) {
          this.light.sendCommands(this.commands[this.type].warmer(this.zone));
          this.log.debug("[" + this.name + "] Sending bulb warmer command");
        }
      }
    }
  }
  callback(null);
};

MiLightAccessory.prototype.setSaturation = function (value, callback) {
  if (this.type === "rgbw") {
    if (value === 0) {
      // Send on command to ensure we're addressing the right bulb
      this.lightbulbService.setCharacteristic(Characteristic.On, true);
      
      this.log("[" + this.name + "] Saturation set to 0, setting bulb to white");
      this.light.sendCommands(this.commands[this.type].whiteMode(this.zone));
    } else if (this.lightbulbService.getCharacteristic(Characteristic.Hue).value !== 0) {
      // Send on command to ensure we're addressing the right bulb
      this.lightbulbService.setCharacteristic(Characteristic.On, true);
      
      this.log.info("[" + this.name + "] Saturation set to %s, but hue is not 0, resetting hue", value);
      this.light.sendCommands(this.commands[this.type].hue(helper.hsvToMilightColor([this.lightbulbService.getCharacteristic(Characteristic.Hue).value, 0, 0])));
    } else {
      this.log.info("[" + this.name + "] Setting saturation to %s (NOTE: No impact on %s %s bulbs)", value, this.type, this.log.prefix);
    }
  } else if (this.type === "fullColor"){
    // Send on command to ensure we're addressing the right bulb
    this.lightbulbService.setCharacteristic(Characteristic.On, true);
    
    this.log("[" + this.name + "] Setting saturation to %s", value);
    this.light.sendCommands(this.commands[this.type].saturation(this.zone, value));
    
  } else {
    this.log.info("[" + this.name + "] Setting saturation to %s (NOTE: No impact on %s %s bulbs)", value, this.type, this.log.prefix);
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
