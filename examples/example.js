/**
 * Copyright (C) 2016 Auralia
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var nsapi = require("nsapi");
var nstg = require("../lib/api");

// TODO: Replace client key, telegram ID and telegram secret key with your own
var clientKey = "<client key>";
var telegramId = "<telegram ID>";
var telegramKey = "<telegram secret key>";

// TODO: Replace the user agent with your own
var api = new nsapi.NsApi("Auralia");
var tgapi = new nstg.NsTgApi(api, clientKey);

// Evaluates a TRL string that retrieves:
// - the nation Auralia, but only if it has the category
//   "Inoffensive Centrist Democracy" and has a census score of between
//   0-99999 for ID 17
// - the WA member states in Testregionia except Testlandia
// - the WA delegates of the feeder regions
// - at most 5 new nations
// - at most 10 refounded nations
function evaluateTrlExample() {
    var trl = "  (nations [Auralia]; /categories [Inoffensive Centrist Democracy]; /census [17, 0, 999999];);"
              + "(regions [Testregionia]; /wa [members]; -nations [Testlandia];);"
              + "(tags [feeder]; /wa [delegates];);"
              + "new [5];"
              + "refounded [10];";
    return tgapi.evaluateTrl(trl).then(function(nations) {
        console.log(nations);
    });
}

// The following sample sends a telegram to all World Assembly nations in
// Catholic and prints out associated information, but only if they have
// recruitment telegrams enabled.
function sendTelegramsTrlExample() {
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

    tgapi.sendTelegramsTrl("regions [Catholic]; /wa [members];", {
        telegramId: telegramId,
        telegramKey: telegramKey,
        telegramType: nsapi.TelegramType.Recruitment,
        doNotSendIfRecruitBlocked: true,
        doNotSendIfCampaignBlocked: false
    }).then(function(id) {
        console.log("Job ID: " + id);
    }).catch(function(err) {
        console.log(err);
    });

    return new Promise(function(resolve) {
        tgapi.onJobComplete = function() {
            console.log("Finished sending telegrams.");
            resolve();
        };
    });
}

// The following sample continuously sends telegrams to new nations with a
// category of "Capitalist Paradise" and a value greater than $10,000 for the
// Average Poor Incomes census score.
function sendTelegramsTrlContinuousExample() {
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

    var trl = "  +new [500];"
              + "/categories [Capitalist Paradise];"
              + "/census [73, 10000, 999999];";
    tgapi.sendTelegramsTrl(trl, {
        telegramId: telegramId,
        telegramKey: telegramKey,
        telegramType: nsapi.TelegramType.Recruitment,
        doNotSendIfRecruitBlocked: false,
        doNotSendIfCampaignBlocked: false
    }, true).then(function(id) {
        console.log("Job ID: " + id);
    }).catch(function(err) {
        console.log(err);
    });

    return new Promise(function(resolve) {
        tgapi.onJobComplete = function() {
            console.log("Finished sending telegrams.");
            resolve();
        };
    });
}

// The following code executes each example.
Promise.resolve()
       .then(function() {
           console.log("Evaluate TRL example:\n");
           return evaluateTrlExample();
       })
       .then(function() {
           console.log("\nSend telegrams (TRL string) example:\n");
           return sendTelegramsTrlExample();
       })
       .then(function() {
           console.log("\nSend telegrams (TRL string continuous) example:\n");
           return sendTelegramsTrlContinuousExample();
       })
       .then(function() {
           tgapi.cleanup();
           api.cleanup();
       })
       .catch(function(err) {
           console.log(err);
       });
