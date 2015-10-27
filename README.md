# awsm-npm-registry

This awsm provides super simple serverless private NPM registry, with fallback to official npmjs.org registry. It uses S3 for storing packages and metadata. Releases can be uploaded directly to configured S3 bucket and `publish` action will automatically pick them up and update the metadata for given package, given that S3 event notifications for lambda are set up.

Please be aware that support for NPM features is currently limited. Current version supports fetching packages only with exact version number, latest or versions with caret.

### Setup

1. Install [JAWS](http://jawsframework.com) `npm install -g jaws-framework` and create a new project `jaws project create`

2. Install this module `npm install inbot/awsm-npm-registry --save`

3. Set required ENV variables.
   
   ```
   # Set your registry bucket name. Value should be <stage>.registry.<domain>, domain being the value that you entered when you created a new JAWS project or stage.
   jaws env set <stage> all REGISTRY_BUCKET_NAME <bucket_name>
   
   # Set registry bucket region. Region is the same region that you selected when creating the project or new stage. 
   jaws env set <stage> all REGISTRY_BUCKET_REGION <region>
   
   # Optional: Disable fallback to npmjs.org registry when package is not found from your registry. Defaults to false.
   jaws env set <stage> all REGISTRY_FALLBACK_DISABLED true
   ```
   
4. Tell JAWS to update and deploy CloudFormation stack with additional resources added from `awsm-npm-registry` module. Run `jaws deploy resources <stage> <region>`
   
5. Deploy your project with `jaws dash`. Remember to select all `awsm-npm-registry` related actions and endpoints.

6. Notice the API Gateway endpoint URL that is printed out. This will be the base URL of your registry.

7. Set up [S3 event notifications](#set-up-s3-event-notifications) for your `publish` lambda

Now you should have a private NPM registry to be used with NPM.


### Set up S3 event notifications

S3 event notifications are not currently automatically created due some limitations on awsm CloudFormation templates. You need to configure S3 notifications manually for every stage, but only once.

Check out [Enabling Event Notifications](http://docs.aws.amazon.com/AmazonS3/latest/UG/SettingBucketNotifications.html) on how to enable event notifications for a lambda.

Lambda function that you are looking for is  `<stage>-<project_name>-l-lAwsmNpmRegistryPublish-*`. Open tab `Event Sources` and click `Add event source`. Fill in the following values and submit.

```
Event source: S3
Bucket: <stage>.registry.<domain>
Event type: Object created (All)
Suffix: .tgz
```

Now `lAwsmNpmRegistryPublish` lambda should receive an event whenever new tarballs are pushed to the S3 bucket.

### Publish packages

New packages can be published to registry simply by uploading them to the S3 bucket. Just use `npm pack` to create a tarball and then upload it to S3 bucket under path `<package_name>/`

```
$ cd npm-package
$ npm pack
npm-package-0.0.1.tgz

$ aws s3 cp ./npm-package-<version>.tgz s3://<stage>-<domain>/<package_name>/ --acl public-read
```

### TODO

- set up S3 notifications automatically for lambda via CloudFormation stack
- support for `npm publish`
- better support for [semver](https://github.com/npm/node-semver) version queries.
- better error handling for main action.
- authentication
- figure out ENV variables automatically
