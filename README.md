# nstg #

[![npm version](https://badge.fury.io/js/nstg.svg)](https://badge.fury.io/js/nstg)

nstg is a free and open source library that allows Node.js applications to 
easily send telegrams to a list of recipients defined using a powerful query 
language called Telegram Recipient Language.

nstg features the following:

* ability to send telegrams to complex sets of nations defined using TRL or to
  simple lists of nations
* a continuous mode that periodically updates the recipients list with new
  nations that match the provided TRL string, which is useful for recruitment 
  purposes
* progress reporting using event handlers
* all the features of nsapi, including rate-limiting, XML decoding, request
  caching, and support for version 9 of the NationStates API

## Usage ##

You can install nstg using npm: `npm install nstg`.

You can also build nstg from source using Gulp. There are two main targets: 
`prod` and `dev`. The only difference between them is that `dev` includes
source maps. There is also a `docs` target to generate documentation.

Consult [the documentation](https://github.com/auralia/node-nstg) 
for more information on API structure and methods, or 
[this page](https://github.com/auralia/node-nstg/blob/master/docs/trl.md)
for more information on TRL.

## Examples ##

The following is a simple example that sends a telegram to the nation Auralia:

```js
var nsapi = require("nsapi");
var nstg = require("nstg");

// TODO: Replace client key, telegram ID and telegram secret key with your own
var clientKey = "<client key>";
var telegramId = "<telegram ID>";
var telegramKey = "<telegram secret key>";

// TODO: Replace the user agent with your own
var api = new nsapi.NsApi("<user agent>");
var tgapi = new nstg.NsTgApi(api, clientKey);

tgapi.onJobStart = function() {
    console.log("Started sending telegrams.");
};

tgapi.onTgSuccess = function(recipient) {
    console.log("Recipient succeeded: " + recipient.nation);
};

tgapi.onTgFailure = function(recipient) {
    console.log("Recipient failed: " + recipient.nation);
    console.log(recipient.status.err);
};

tgapi.onJobComplete = function() {
    console.log("Finished sending telegrams.");
    tgapi.cleanup();
    api.cleanup();
};

tgapi.sendTelegramsTrl("nations [Auralia];", {
    telegramId: telegramId,
    telegramKey: telegramKey,
    telegramType: nsapi.TelegramType.NonRecruitment,
    doNotSendIfRecruitBlocked: false,
    doNotSendIfCampaignBlocked: false
}).then(function(id) {
    console.log("Job ID: " + id);
}).catch(function(err) {
    console.log(err);
});
```

See examples/example.js for other examples on how to use nstg.

## License ##

nstg is licensed under the [Apache License 2.0](http://www.apache.org/licenses/LICENSE-2.0).
