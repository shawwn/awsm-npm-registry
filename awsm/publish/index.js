var crypto = require('crypto');
var fs = require('fs');
var through = require('through2');
var tar = require('tar');
var jsonjs = require('jsonjs');

var AWS = require('aws-sdk');
var s3 = new AWS.S3({apiVersion: '2006-03-01'});
var cp = require('child_process');
var naturalSort = require('javascript-natural-sort');

var bucketName = process.env.REGISTRY_BUCKET_NAME;
var bucketRegion = process.env.REGISTRY_BUCKET_REGION;

/**
 * AWS Module: Action: Modularized Code
 */

var shasum = function(buf) {
  var sum = crypto.createHash('sha1');
  sum.update(buf);
  return sum.digest('hex');
}

// Export For Lambda Handler
module.exports.run = function(event, context, cb) {
  var callStack = [];
  var record = event.Records[0];

  var key = record.s3.object.key;
  var packageName = key.split('/')[0];
  var tarball = key.replace(packageName + "/", '');

  console.log('new tarball found from S3:', tarball, key);
  console.log('new package:', packageName);

  var next = function(err, data) {
    if(err) {
      return cb(err, data);
    }

    var func = callStack.shift();
    if(!func) {
      return cb(null, data);
    }

    func(data, next);
  };

  callStack.push(function(data, next){
    var url = [packageName, '_metadata.json'].join('/');
    s3.getObject({
      Bucket: bucketName,
      Key: url
    }, function(err, resp) {
      if (err) {
        if(err.statusCode == 404) {
          console.log('Unknown package, creating metadata for the first release.');
          var template = {
            "_id": packageName,
            "_rev": "1-" + packageName,
            "name": packageName,
            "description": "Test",
            "versions": {
            },
            "_attachments": {}
          }
          data.metadata = template;
          return next(null, data);
        } else {
          console.log('Object', url, 'lookup error', err, err.stack); // an error occurred
          return next(err, data);
        }
      }

      if(resp.ContentType == 'application/json') {
        try {
          data.metadata = JSON.parse(resp.Body.toString('utf8'));
        } catch(e) {
          throw "Bad Request: unable to parse metadata"
          var err = new Error("Bad Request: unable to parse metadata");
          return next(err);
        }
        return next(null, data);
      }

      var err = new Error("package does not exist");
      next(err, data);
    });
  });

  callStack.push(function(data, next){
    s3.getObject({
      Bucket: bucketName,
      Key: key
    }, function(err, resp) {
      if (err) {
        console.log('Object', url, 'lookup error', err, err.stack); // an error occurred
        return next(err, data);
      }

      data.package = {};

      fs.writeFile("/tmp/" + tarball, resp.Body, function(err) {
        if(err) {
          return next(err);
        }

        data._tempfile = "/tmp/" + tarball;
        return next(null, data);
      });
    });
  });

  callStack.push(function(data, next){
    var sum = crypto.createHash('sha1');
    var s = fs.createReadStream(data._tempfile);

    s.on('data', function(d) {
      sum.update(d);
    });

    s.on('end', function() {
      var d = sum.digest('hex');
      console.log(d + '  ' + data._tempfile);
      data._shasum = d;
      return next(null, data);
    });

    s.on('error', function(err) {
      return next(err);
    });
  });

  callStack.push(function(data, next){
    cp.exec("gunzip " + data._tempfile, function(err){
      if(err){
        return next(err);
      }
      data._tempfile = data._tempfile.replace(".tgz", ".tar");
      return next(null, data);
    });
  });

  callStack.push(function(data, next){
    console.log('DATA:', data);
    var readable;
    console.log('should start parsing');

    var reader = new tar.Parse();
    reader.on("entry", function (e) {
      console.log('header:', e.path);
      if ('package/package.json' == e.path) {
        console.log('found package.json');
        var chunk = '';
        e.on("data", function (c) {
          console.log('chunk:', c);
          chunk += c.toString();
        });
        e.on("end", function () {
          console.log("  <<<EOF")
          data.package = JSON.parse(chunk);
          return next(null, data);
        });
      }
    });

    readable = fs.createReadStream(data._tempfile);
    readable.pipe(reader);
  });

  callStack.push(function(data, next){
    var j = jsonjs.decoratedCopy(data.metadata);
    var p = jsonjs.decoratedCopy(data.package);

    // inject id to our package.json
    p.put('_id', [p.getString('name'), p.getString('version')].join('@'));

    // add shasum and download URL
    p.getOrCreateDecoratedObject('dist')
      .put('shasum', data._shasum)
      .put('tarball', "https://s3-" + bucketRegion + ".amazonaws.com/" + bucketName + "/" + key);

    var vj = j.getOrCreateDecoratedObject('versions');
    var latest;

    if(vj.keys().length > 0) {
      latest = vj.keys().sort(naturalSort).reverse()[0];
    }

    // add package.json contents for this version
    var version = data.package.version;
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

    console.log('DATA:', data);
    console.log('METADATA:', data.metadata);
    console.log('PACKAGE JSON:', data.package);
    console.log('NEW METADATA', j.object());
    next(null, {
      metadata: j.object(),
      data: data
    });
  });

  callStack.push(function(data, next){
    var url = [packageName, '_metadata.json'].join('/');
    s3.putObject({
      Bucket: bucketName,
      Key: url,
      Body: JSON.stringify(data.metadata),
      ContentType: 'application/json',
      ACL: 'private'
    }, function(err, resp){
      if (err) {
        console.log('Object', url, 'lookup error', err, err.stack); // an error occurred
        return next(err, data);
      }
      // console.log('_metadata updated', JSON.stringify(data.metadata));
      next(null, data);
    });
  });

  callStack.push(function(data, next){
    console.log('SUCCESS!');
    next(null, data);
  });

  next(null, {});
};
