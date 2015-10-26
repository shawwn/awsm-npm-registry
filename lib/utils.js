var jsonjs = require('jsonjs');
var request = require('superagent');
var tar = require('tar');
var naturalSort = require('javascript-natural-sort');
require("babelify-es6-polyfill");

var AWS = require('aws-sdk');
var s3 = new AWS.S3({apiVersion: '2006-03-01'});

var fs = require('fs');
var crypto = require('crypto');
var cp = require('child_process');

var bucketName = process.env.REGISTRY_BUCKET_NAME;
var bucketRegion = process.env.REGISTRY_BUCKET_REGION;

module.exports = {
  getObject(key, options = {}) {
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

  putObject(key, body, options = {}) {
    var params = Object.assign({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ACL: 'public-read'
    }, options);

    return new Promise((resolve, reject) => {
      s3.putObject(params, (err, resp) => {
        if(err) {
          console.log('S3.putObject ERROR', key, err);
          return reject(err);
        }
        console.log('S3.putObject SUCCESS', key);
        resolve(resp);
      });
    });
  },

  getObjectToTempfile(key, filename) {
    return this.getObject(key)
      .then(resp => {
        return new Promise((resolve, reject) => {
          console.log('writing object', key, 'to tempfile', filename);
          fs.writeFile("/tmp/" + filename, resp.Body, function(err) {
            if(err) {
              return reject(err);
            }

            var tempfile = "/tmp/" + filename;
            console.log('tempfile done.');
            return resolve(tempfile);
          });
        });
      });
  },

  getPackageMetadata(packageName) {
    var key = `${packageName}/_metadata.json`;
    console.log('Getting metadata for', key);
    return new Promise((resolve, reject) => {
      this.getObject(key)
        .then((resp) => {
          return resolve(this._parsePackageMetadata(resp));
        })
        .catch(reject);
    });
  },

  getPackageMetadataOrTemplate(packageName) {
    var key = `${packageName}/_metadata.json`;
    console.log('Getting metadata for', key);
    return new Promise((resolve, reject) => {
      this.getObject(key)
        .then((resp) => {
          return resolve(this._parsePackageMetadata(resp));
        })
        .catch(err => {
          if(err.statusCode == 404) {
            return resolve(this._createPackageMetadata(packageName));
          }
          reject(err);
        });
    });
  },

  putPackageMetadata(packageName, payload) {
    var options = {
      Body: JSON.stringify(payload),
      ContentType: 'application/json',
      ACL: 'private'
    };
    var key = `${packageName}/_metadata.json`;
    return this.putObject(key, {}, options);
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
  },

  generateShasum(file) {
    return new Promise((resolve, reject) => {
      var sum = crypto.createHash('sha1');
      var s = fs.createReadStream(file);

      s.on('data', function(d) {
        sum.update(d);
      });

      s.on('end', function() {
        var d = sum.digest('hex');
        console.log('SHASUM:', file, ' => ', d);
        return resolve(d);
      });

      s.on('error', function(err) {
        return reject(err);
      });
    });
  },

  decompressTarball(file) {
    return new Promise((resolve, reject) => {
      cp.exec("gunzip " + file, function(err){
        if(err){
          return reject(err);
        }
        return resolve(file.replace(".tgz", ".tar"));
      });
    })
  },

  grepPackageMetadata(tarball) {
    return new Promise((resolve, reject) => {
      var readable;
      var reader = new tar.Parse();

      reader.on('entry', (e) => {
        if ('package/package.json' == e.path) {
          console.log('found package.json');
          var chunk = '';
          e.on("data", (c) => {
            chunk += c.toString();
          });

          e.on("end", () => {
            return resolve(JSON.parse(chunk));
          });

          e.on('error', err => {
            return reject(err);
          });
        }
      });

      readable = fs.createReadStream(tarball);
      readable.pipe(reader);
    });
  },

  updatePackageMetadata(metadata, packageMetadata, shasum, key) {
    var j = jsonjs.decoratedCopy(metadata);
    var p = jsonjs.decoratedCopy(packageMetadata);

    // inject id to our package.json
    p.put('_id', [p.getString('name'), p.getString('version')].join('@'));

    // add shasum and download URL
    p.getOrCreateDecoratedObject('dist')
      .put('shasum', shasum)
      .put('tarball', "https://s3-" + bucketRegion + ".amazonaws.com/" + bucketName + "/" + key);

    var vj = j.getOrCreateDecoratedObject('versions');
    var latest;

    if(vj.keys().length > 0) {
      latest = vj.keys().sort(naturalSort).reverse()[0];
    }

    // add package.json contents for this version
    var version = p.getString('version');
    vj.put(version, p.object());

    // promote the lates
    if(!latest || version > latest) {
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

  _parsePackageMetadata(resp) {
    if(resp.ContentType !== 'application/json') {
      console.log('Wrong content type.');
      throw new Error('Wrong content type. Package does not exist.');
    }
    console.log('Metadata found, parsing...');
    var data = JSON.parse(resp.Body.toString('utf8'));
    return data;
  },

  _createPackageMetadata(packageName) {
    return {
      "_id": packageName,
      "_rev": "1-" + packageName,
      "name": packageName,
      "description": "",
      "versions": {
      },
      "_attachments": {}
    }
  }


}
