"use strict";

var utils = require('awsm-npm-registry').utils;
var Promise = utils.promise;

module.exports.run = function (event, context, cb) {
  var record = event.Records[0]; // FIXME: process multiple records

  var key = record.s3.object.key;
  var packageName = key.split('/')[0];
  var tarball = key.replace(packageName + "/", '');

  var _metadata, _tempfile, _shasum;

  utils.checkEnv();

  utils.getPackageMetadataOrTemplate(packageName)
    .then(function (metadata) {
      _metadata = metadata;
      return utils.getObjectToTempfile(key, tarball);
    })
    .then(function (tempfile) {
      _tempfile = tempfile;
      return Promise.resolve(tempfile);
    })
    .then(utils.generateShasum)
    .then(function (shasum) {
      _shasum = shasum;
      return Promise.resolve(_tempfile);
    })
    .then(utils.decompressTarball)
    .then(utils.grepPackageMetadata).then(function (packageMetadata) {
      var metadata = utils.updatePackageMetadata(_metadata, packageMetadata, _shasum, key);
      return Promise.resolve(metadata);
    })
    .then(function (payload) {
      return utils.putPackageMetadata(packageName, payload);
    })
    .then(function (resp) {
      console.log('SUCCESS!');
      cb(null, { message: 'success!' });
    }).catch(function (err) {
      console.log('ERROR while processing uploaded tarball:', err);
      cb(err, {});
    });
};
