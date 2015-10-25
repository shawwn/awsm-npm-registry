var AWS = require('aws-sdk');
var request = require('superagent');
var s3 = new AWS.S3({apiVersion: '2006-03-01'});
var bucketName = process.env.REGISTRY_BUCKET_NAME;

module.exports.run = function(event, context, cb) {
  var packageName = event.package_name;
  var callStack = [];

  var finished = function(err, data) {
    callStack = [];
    return cb(err, data);
  };

  var next = function(err, data) {
    if(err) {
      return cb(err, data);
    }

    var func = callStack.shift();
    if(!func) {
      return finished(null, data);
    }

    func(data, next);
  };

  // try to get package metadata file, which describes available versions
  // and current latest in flavor of npmjs.org
  callStack.push(function(data, next) {
    var url = [packageName, '_metadata.json'].join('/');
    s3.getObject({
      Bucket: bucketName,
      Key: url
    }, function(err, resp) {
      if (err) {
        console.log('Object', url, 'lookup error', err, err.stack); // an error occurred
        return next(null, data);
      }

      if(resp.ContentType == 'application/json') {
        try {
          data = JSON.parse(resp.Body.toString('utf8'));
        } catch(e) {
          throw "Bad Request: unable to parse metadata"
          var err = new Error("Bad Request: unable to parse metadata");
          return next(err);
        }
        return finished(null, data);
      }

      var err = new Error("package does not exist");
      next(err, data);
    });
  });

  // passthrough to npmjs registry
  callStack.push(function(data, next){
    var url = 'http://registry.npmjs.org/' + packageName;
    request.get(url)
      .type('json')
      .end(function(err, resp){
        if(err) {
          return next(new Error("package " + packageName + " does not exist "), {});
        }

        return next(null, resp.body);
      });
  });

  next(null, {});
};
