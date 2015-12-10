/*
MiLight Homebridge Plugin
By Sam Edwards (dotsam)
*/

var Milight = require('node-milight-promise').MilightController;
var commands = require('node-milight-promise').commands;
var Service, Characteristic;

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerAccessory("homebridge-milight","MiLight", MiLightAccessory);
  homebridge.registerPlatform("homebridge-milight","MiLight", MiLightPlatform);
}

function MiLightPlatform(log, config) {
  this.log = log;
  
  this.config = config;
}

MiLightPlatform.prototype = {
  accessories: function(callback) {
    var zones = [];

    // Various error checking    
    if (this.config.zones) {
      var zoneLength = this.config.zones.length;
    } else {
      this.log("ERROR: Could not read zones from configuration.");
      return;
    }

    if (!this.config["type"]) {
      this.log("INFO: Type not specified, defaulting to rgbw");
      this.config["type"] = "rgbw";
    }

    if (zoneLength == 0) {
      this.log("ERROR: No zones found in configuration.");
      return;
    } else if (this.config["type"] == "rgb" && zoneLength > 1) {
      this.log("WARNING: RGB lamps only have a single zone. Only the first defined zone will be used.");
      zoneLength = 1;
    } else if (zoneLength > 4) {
      this.log("WARNING: Only a maximum of 4 zones are supported per bridge. Only recognizing the first 4 zones.");
      zoneLength = 4;
    }

    // Create lamp accessories for all of the defined zones
    for (var i=0; i < zoneLength; i++) {
      if (!!this.config.zones[i]) {
        this.config["name"] = this.config.zones[i];
        this.config["zone"] = i+1;
        lamp = new MiLightAccessory(this.log, this.config);
        zones.push(lamp);
      }
    }
    if (zones.length > 0) {
      callback(zones);
    } else {
      this.log("ERROR: Unable to find any valid zones");
      return;
    }
  }
}

function MiLightAccessory(log, config) {
  this.log = log;

  // config info
  this.ip_address = config["ip_address"];
  this.port = config["port"];
  this.name = config["name"];
  this.zone = config["zone"];
  this.type = config["type"];
  this.delay = config["delay"];
  this.repeat = config["repeat"];

  this.light = new Milight({
    ip: this.ip_address,
    port: this.port,
    delayBetweenCommands: this.delay,
    commandRepeat: this.repeat
  });

}
MiLightAccessory.prototype = {

  setPowerState: function(powerOn, callback) {
    if (powerOn) {
      this.log("["+this.name+"] Setting power state to on");
      this.light.sendCommands(commands[this.type].on(this.zone));
    } else {
      this.log("["+this.name+"] Setting power state to off");
      this.light.sendCommands(commands[this.type].off(this.zone));
    }
    callback();
  },

  setBrightness: function(level, callback) {
    if (level == 0) {
      // If brightness is set to 0, turn off the lamp
      this.log("["+this.name+"] Setting brightness to 0 (off)");
      this.light.sendCommands(commands[this.type].off(this.zone));
    } else if (level <= 2 && (this.type == "rgbw" || this.type == "white")) {
      // If setting brightness to 2 or lower, instead set night mode for lamps that support it
      this.log("["+this.name+"] Setting night mode");

      this.light.sendCommands(commands[this.type].off(this.zone));
      // Ensure we're pausing for 100ms between these commands as per the spec
      this.light.pause(100);
      this.light.sendCommands(commands[this.type].nightMode(this.zone));

    } else {
      this.log("["+this.name+"] Setting brightness to %s", level);

      // Send on command to ensure we're addressing the right bulb
      this.light.sendCommands(commands[this.type].on(this.zone));

      // If this is an rgbw lamp, set the absolute brightness specified
      if (this.type == "rgbw") {
        this.light.sendCommands(commands.rgbw.brightness(level));
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
    callback();
  },

  setHue: function(value, callback) {
    this.log("["+this.name+"] Setting hue to %s", value);

    var hue = Array(value, 0, 0);

    // Send on command to ensure we're addressing the right bulb
    this.light.sendCommands(commands[this.type].on(this.zone));

    if (this.type == "rgbw") {
      if (value == 0) {
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
    callback();
  },

  identify: function(callback) {
    this.log("["+this.name+"] Identify requested!");
    callback(); // success
  },

  getServices: function() {
    var informationService = new Service.AccessoryInformation();

    informationService
      .setCharacteristic(Characteristic.Manufacturer, "MiLight")
      .setCharacteristic(Characteristic.Model, this.type)
      .setCharacteristic(Characteristic.SerialNumber, "MILIGHT12345");

    var lightbulbService = new Service.Lightbulb();

    lightbulbService
      .getCharacteristic(Characteristic.On)
      .on('set', this.setPowerState.bind(this));

    lightbulbService
      .addCharacteristic(new Characteristic.Brightness())
      .on('set', this.setBrightness.bind(this));

    lightbulbService
      .addCharacteristic(new Characteristic.Hue())
      .on('set', this.setHue.bind(this));

    return [informationService, lightbulbService];
  }
};
