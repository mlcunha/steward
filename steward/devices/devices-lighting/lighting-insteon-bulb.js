// Insteon LED bulb: http://www.insteon.com/bulb.html

var util        = require('util')
  , devices     = require('./../../core/device')
  , steward     = require('./../../core/steward')
  , utility     = require('./../../core/utility')
  , lighting    = require('./../device-lighting')
  ;


var logger = lighting.logger;


var Insteon = exports.Device = function(deviceID, deviceUID, info) {
  var self = this;

  self.whatami = '/device/lighting/insteon/led';
  self.deviceID = deviceID.toString();
  self.deviceUID = deviceUID;
  self.name = info.device.name;
  self.getName();

  self.status = 'waiting';
  self.changed();
  self.gateway = info.gateway;
  self.insteon = info.device.unit.serial;
  self.info = { color: { model: 'rgb', rgb: { r: 255, g: 255, b: 255 }, fixed: true } };

  utility.broker.subscribe('actors', function(request, taskID, actor, perform, parameter) {
    if (actor !== ('device/' + self.deviceID)) return;

    if (request === 'perform') return self.perform(self, taskID, perform, parameter);
  });

  self.gateway.upstream[self.insteon] = self;
  self.refresh(self);
  setInterval(function() { self.refresh(self); }, 30 * 1000);
};
util.inherits(Insteon, lighting.Device);


Insteon.prototype.refresh = function(self) {
  self.gateway.roundtrip(self.gateway, '0262' + self.insteon + '001900');
};

Insteon.prototype.callback = function(self, messageType, message) {
  switch (message.substr(0, 4)) {
    case '0250':
      switch (message.substr(message.length - 6, 2)) {
        case '20':
          return self.brightness(self, message.substr(-2));

        default:
          break;
      }
      break;

    case '0262':
      if (message.substr(-2) !== '06') {
        return logger.error('device/' + self.deviceID, { event: 'request failed', response: message });
      }

      switch (message.substr(message.length - 8, 4)) {
        case '0011':
        case '0013':
          return self.brightness(self, message.substr(-4));

        default:
          break;
      }
      break;

    default:
      break;
  }
  return logger.warning('device/' + self.deviceID, { event: 'unexpected message', message: message });
};

Insteon.prototype.brightness = function(self, bri) {
  var brightness = devices.percentageValue(parseInt(bri, 16), 255);

  if (brightness === 0) {
    if ((self.status === 'off') && (self.info.brightness === brightness)) return;

    self.status = 'off';
    self.info.brightness = 0;
    return self.changed ();
  }

  if ((self.status === 'on') && (self.info.brightness === brightness)) return;

  self.status = 'on';
  self.info.brightness = brightness;
  return self.changed ();
};


var insteonBrightness = function(pct) {
  return ('0' + devices.scaledPercentage(pct, 1,  255).toString(16)).substr(-2);
};

Insteon.prototype.perform = function(self, taskID, perform, parameter) {
  var params, state;

  state = {};
  try { params = JSON.parse(parameter); } catch(ex) { params = {}; }

  if (perform === 'set') return self.setName(params.name, taskID);

  if (perform === 'off') state.on = false;
  else if (perform !== 'on') return;
  else {
    state.on = true;

    if (!params.brightness) params.brightness = self.info.brightness;
    if (params.brightness <= 0) params.brightness = 100;
    state.brightness = insteonBrightness(params.brightness);
  }

  logger.info('device/' + self.deviceID, { perform: state });

  self.gateway.roundtrip(self.gateway, '0262' + self.insteon + '00' + (state.on ? ('11' + state.brightness) : '1300'));
  return steward.performed(taskID);
};

var validate_perform = function(perform, parameter) {
  var params = {}
    , result = { invalid: [], requires: [] };

  if (perform === 'off') return result;

  if (!parameter) {
    result.requires.push('parameter');
    return result;
  }
  try { params = JSON.parse(parameter); } catch(ex) { result.invalid.push('parameter'); }

  if (perform === 'set') {
    if (!params.name) result.requires.push('name');
    return result;
  }

  if (perform !== 'on') result.invalid.push('perform');

  if ((!!params.brightness) && (!lighting.validBrightness(params.brightness))) result.invalid.push('brightness');

  return result;
};


exports.start = function() {
  steward.actors.device.lighting.insteon = steward.actors.device.lighting.insteon ||
      { $info     : { type: '/device/lighting/insteon' } };

  steward.actors.device.lighting.insteon.led =
      { $info     : { type       : '/device/lighting/insteon/led'
                    , observe    : [ ]
                    , perform    : [ 'off', 'on' ]
                    , properties : { name       : true
                                   , status     : [ 'waiting', 'on', 'off' ]
                                   , brightness : 'percentage'
                                   }
                    }
      , $validate : { perform    : validate_perform }
      };
// other Insteon devices corresponding to a single bulb may also be listed here...
  devices.makers['Insteon.013a'] = Insteon;
};
