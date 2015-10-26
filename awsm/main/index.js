"use strict";

var utils = require('awsm-npm-registry').utils;

module.exports.run = function (event, context, cb) {
  var packageName = event.package_name;

  var passthrough = function passthrough() {
    utils.getPackageFromOfficialRegistry(packageName)
      .then(function (data) {
        cb(null, data);
      }).catch(function (err) {
        cb(err, {});
      });
  };

  utils.getPackageMetadata(packageName)
    .then(function (metadata) {
      return cb(null, metadata);
    }).catch(function (err) {
      if (err.message.indexOf('does not exist') > -1) {
        return passthrough();
      }
      return cb(err, {});
    });
};
