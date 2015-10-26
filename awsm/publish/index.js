var utils = require('awsm-npm-registry').utils;

module.exports.run = function(event, context, cb) {
  var record = event.Records[0]; // FIXME: process multiple records

  var key = record.s3.object.key;
  var packageName = key.split('/')[0];
  var tarball = key.replace(packageName + "/", '');

  var _metadata, _tempfile, _shasum;

  utils.getPackageMetadataOrTemplate(packageName)
    .then((metadata) => {
      _metadata = metadata;
      return utils.getObjectToTempfile(key, tarball);
    })
    .then((tempfile) => {
      _tempfile = tempfile;
      return Promise.resolve(tempfile);
    })
    .then(utils.generateShasum)
    .then((shasum) => {
      _shasum = shasum;
      return Promise.resolve(_tempfile);
    })
    .then(utils.decompressTarball)
    .then(utils.grepPackageMetadata)
    .then((packageMetadata) => {
      var metadata = utils.updatePackageMetadata(_metadata, packageMetadata, _shasum, key);
      return Promise.resolve(metadata);
    })
    .then((payload) => {
      return utils.putPackageMetadata(packageName, payload);
    })
    .then((resp) => {
      console.log('SUCCESS!');
      cb(null, {message: 'success!'});
    })
    .catch(err => {
      console.log('ERROR while processing uploaded tarball:', err);
      cb(err, {});
    });
};
