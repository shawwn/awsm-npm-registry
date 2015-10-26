var utils = require('awsm-npm-registry').utils;

module.exports.run = function(event, context, cb) {
  var packageName = event.package_name;
  var callStack = [];

  var passthrough = function() {
    utils.getPackageFromOfficialRegistry(packageName)
      .then(data => {
        cb(null, data);
      })
      .catch(err => {
        cb(err, {});
      })
  }

  utils.getPackageMetadata(packageName)
    .then(metadata => {
      return cb(null, metadata);
    })
    .catch(err => {
      if(err.message.indexOf('does not exist') > -1) {
        return passthrough();
      }
      return cb(err, {});
    });
};
