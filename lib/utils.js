var AWS = require('aws-sdk');
var request = require('superagent');
var s3 = new AWS.S3({apiVersion: '2006-03-01'});
require("babelify-es6-polyfill");

var bucketName = process.env.REGISTRY_BUCKET_NAME;

module.exports = {
  _getObject(key, options = {}) {
    console.log('S3.getObject:', bucketName, key, options);
    return new Promise((resolve, reject) => {
      s3.getObject(Object.assign({
        Bucket: bucketName,
        Key: key
      }, options), function(err, resp){
        if(err) {
          console.log('S3.getObject ERROR:', err);
          return reject(err);
        }
        return resolve(resp);
      });
    });
  },

  getPackageMetadata(packageName) {
    var key = `${packageName}/_metadata.json`;
    console.log('Getting metadata for', key);
    return new Promise((resolve, reject) => {
      this._getObject(key)
        .then((resp) => {
          if(resp.ContentType !== 'application/json') {
            console.log('Wrong content type.');
            return reject(new Error('Wrong content type. Package does not exist.'));
          }
          console.log('Metadata found, parsing...');
          data = JSON.parse(resp.Body.toString('utf8'));
          console.log('Metadata parsed');
          return resolve(data);
        })
        .catch(reject);
    });
  },

  getPackageFromOfficialRegistry(packageName) {
    var url = 'http://registry.npmjs.org/' + packageName;
    console.log('Getting package', packageName, 'from official registry');
    return new Promise((resolve, reject) => {
      request.get(url)
        .type('json')
        .end(function(err, resp){
          if(err) {
            console.log('Error from npmjs:', err.message, err.status);
            return reject(err);
          }
          return resolve(resp.body);
        });
    });
  }


}
