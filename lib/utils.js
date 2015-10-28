"use strict";

var jsonjs = require('jsonjs');
var request = require('superagent');
var tar = require('tar');
var naturalSort = require('javascript-natural-sort');
var Promise = require('bluebird');

var AWS = require('aws-sdk');
var s3 = new AWS.S3({ apiVersion: '2006-03-01' });

var fs = require('fs');
var crypto = require('crypto');
var cp = require('child_process');

var bucketName = process.env.REGISTRY_BUCKET_NAME;
var bucketRegion = process.env.REGISTRY_BUCKET_REGION;

module.exports = {
  Promise: Promise,

  checkEnv: function checkEnv() {
    if(!bucketName || !bucketRegion) {
      throw new Error("ENV variables not configured properly");
    }
  },

  getObject: function getObject(key) {
    var options = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];

    console.log('S3.getObject:', bucketName, key, options);
    return new Promise(function (resolve, reject) {
      s3.getObject(jsonjs.utils.extend({
        Bucket: bucketName,
        Key: key
      }, options), function (err, resp) {
        if (err) {
          console.log('S3.getObject ERROR:', err);
          return reject(err);
        }
        return resolve(resp);
      });
    });
  },

  putObject: function putObject(key, body) {
    var options = arguments.length <= 2 || arguments[2] === undefined ? {} : arguments[2];

    var params = jsonjs.utils.extend({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ACL: 'public-read'
    }, options);

    return new Promise(function (resolve, reject) {
      s3.putObject(params, function (err, resp) {
        if (err) {
          console.log('S3.putObject ERROR', key, err);
          return reject(err);
        }
        console.log('S3.putObject SUCCESS', key);
        resolve(resp);
      });
    });
  },

  getObjectToTempfile: function getObjectToTempfile(key, filename) {
    return this.getObject(key).then(function (resp) {
      return new Promise(function (resolve, reject) {
        console.log('writing object', key, 'to tempfile', filename);
        fs.writeFile("/tmp/" + filename, resp.Body, function (err) {
          if (err) {
            return reject(err);
          }

          var tempfile = "/tmp/" + filename;
          console.log('tempfile done.');
          return resolve(tempfile);
        });
      });
    });
  },

  getPackageMetadata: function getPackageMetadata(packageName) {
    var _this = this;

    var key = packageName + '/_metadata.json';
    console.log('Getting metadata for', key);
    return new Promise(function (resolve, reject) {
      _this.getObject(key).then(function (resp) {
        return resolve(_this._parsePackageMetadata(resp));
      })['catch'](reject);
    });
  },

  getPackageMetadataOrTemplate: function getPackageMetadataOrTemplate(packageName) {
    var _this = this;

    var key = packageName + '/_metadata.json';
    console.log('Getting metadata for', key);
    return new Promise(function (resolve, reject) {
      _this.getObject(key).then(function (resp) {
        return resolve(_this._parsePackageMetadata(resp));
      })['catch'](function (err) {
        if (err.statusCode == 404) {
          return resolve(_this._createPackageMetadata(packageName));
        }
        reject(err);
      });
    });
  },

  putPackageMetadata: function putPackageMetadata(packageName, payload) {
    var options = {
      Body: JSON.stringify(payload),
      ContentType: 'application/json',
      ACL: 'private'
    };
    var key = packageName + '/_metadata.json';
    return this.putObject(key, {}, options);
  },

  getPackageFromOfficialRegistry: function getPackageFromOfficialRegistry(packageName) {
    var url = 'http://registry.npmjs.org/' + packageName;
    console.log('Getting package', packageName, 'from official registry');
    return new Promise(function (resolve, reject) {
      request.get(url).type('json').end(function (err, resp) {
        if (err) {
          if(err.status == 404) {
            // wrap 404 from npmjs so that API Gateway returns the right error code
            // FIXME: fix error handling w/ API Gateway
            console.log('Not found from npmjs', err.message, err.statusCode);
            return reject(new Error("package does not exist in npmjs.org registry."));
          }

          console.log('Error from npmjs:', err.message, err.status, (err.response || {}).body);
          return reject(err);
        }
        return resolve(resp.body);
      });
    });
  },

  generateShasum: function generateShasum(file) {
    return new Promise(function (resolve, reject) {
      var sum = crypto.createHash('sha1');
      var s = fs.createReadStream(file);

      s.on('data', function (d) {
        sum.update(d);
      });

      s.on('end', function () {
        var d = sum.digest('hex');
        console.log('SHASUM:', file, ' => ', d);
        return resolve(d);
      });

      s.on('error', function (err) {
        return reject(err);
      });
    });
  },

  decompressTarball: function decompressTarball(file) {
    return new Promise(function (resolve, reject) {
      cp.exec("gunzip -f " + file, function (err) {
        if (err) {
          return reject(err);
        }
        return resolve(file.replace(".tgz", ".tar"));
      });
    });
  },

  grepPackageMetadata: function grepPackageMetadata(tarball) {
    return new Promise(function (resolve, reject) {
      var readable;
      var reader = new tar.Parse();

      reader.on('entry', function (e) {
        if ('package/package.json' == e.path) {
          console.log('found package.json');
          var chunk = '';
          e.on("data", function (c) {
            chunk += c.toString();
          });

          e.on("end", function () {
            return resolve(JSON.parse(chunk));
          });

          e.on('error', function (err) {
            return reject(err);
          });
        }
      });

      readable = fs.createReadStream(tarball);
      readable.pipe(reader);
    });
  },

  updatePackageMetadata: function updatePackageMetadata(metadata, packageMetadata, shasum, key) {
    var j = jsonjs.decoratedCopy(metadata);
    var p = jsonjs.decoratedCopy(packageMetadata);

    // inject id to our package.json
    p.put('_id', [p.getString('name'), p.getString('version')].join('@'));

    // add shasum and download URL
    p.getOrCreateDecoratedObject('dist').put('shasum', shasum).put('tarball', "https://s3-" + bucketRegion + ".amazonaws.com/" + bucketName + "/" + key);

    var vj = j.getOrCreateDecoratedObject('versions');
    var latest;

    if (vj.keys().length > 0) {
      latest = vj.keys().sort(naturalSort).reverse()[0];
    }

    // add package.json contents for this version
    var version = p.getString('version');
    vj.put(version, p.object());

    // promote the lates
    if (!latest || version > latest) {
      j.put('dist-tags', 'latest', version);
    }

    var revision = j.getString('_rev');
    var revisionNumber = parseInt(revision.split('-')[0]);
    revisionNumber++;
    j.put('_rev', revisionNumber + "-" + j.getString('name'));

    j.put('name', p.getString('name'));
    j.put('description', p.getString('description'));
    return j.object();
  },

  _parsePackageMetadata: function _parsePackageMetadata(resp) {
    if (resp.ContentType !== 'application/json') {
      console.log('Wrong content type.');
      throw new Error('Wrong content type. Package does not exist.');
    }
    console.log('Metadata found, parsing...');
    var data = JSON.parse(resp.Body.toString('utf8'));
    return data;
  },

  _createPackageMetadata: function _createPackageMetadata(packageName) {
    return {
      "_id": packageName,
      "_rev": "1-" + packageName,
      "name": packageName,
      "description": "",
      "versions": {},
      "_attachments": {}
    };
  }

};
