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
import {getRecipients, ParseError} from "./trl";
import * as clone from "clone";
import {Promise} from "es6-promise";
import {NsApi, TelegramType} from "nsapi";

export {ParseError};

/**
 * Information related to a particular telegram job.
 */
export interface TelegramJob {
    /**
     * The ID of this job.
     */
    id: string;
    /**
     * The TRL string associated with this job.
     */
    trl: string;
    /**
     * The recipients associated with this job.
     */
    recipients: Recipient[];
    /**
     * Information about the telegram associated with this job.
     */
    tgInfo: TelegramInfo;
    /**
     * Whether or not new recipients are being continuously added to the list.
     */
    isContinuous: boolean;
    /**
     * Whether or not any telegrams are actually sent to member states.
     */
    isDryRun: boolean;
    /**
     * Information about the status of the job.
     */
    status: TelegramJobStatus;
}

/**
 * Information about the status of a telegram job.
 */
export interface TelegramJobStatus {
    /**
     * Whether or not this job is currently being processed.
     */
    isStarted: boolean;
    /**
     * Whether or not this job has been completely processed.
     */
    isComplete: boolean;
}

/**
 * Information related to a particular recipient.
 */
export interface Recipient {
    /**
     * The name of the recipient.
     */
    nation: string;
    /**
     * The status of the recipient.
     */
    status: RecipientStatus;
    /**
     * The job ID associated with this recipient.
     */
    jobId: string;
}

/**
 * Information relating to a recipient's status.
 */
export interface RecipientStatus {
    /**
     * Whether or not a telegram was successfully sent to the recipient.
     * This value will be undefined if no attempt to send a telegram was made.
     */
    success?: boolean;
    /**
     * Any error that occurred when trying to send a telegram to this recipient.
     */
    err?: any;
}

/**
 * Information related to a particular telegram.
 */
export interface TelegramInfo {
    /**
     * The associated with this telegram.
     */
    telegramId: string;
    /**
     * The secret key associated with this telegram.
     */
    telegramKey: string;
    /**
     * The type of this telegram: recruitment or non-recruitment. This will
     * determine what delay is used by the NationStates API.
     */
    telegramType: TelegramType;
    /**
     * If set to true, this telegram will not be sent to any nation with
     * recruitment telegrams blocked.
     */
    doNotSendIfRecruitBlocked: boolean;
    /**
     * If set to true, this telegram will not be sent to any nation with
     * campaign telegrams blocked.
     */
    doNotSendIfCampaignBlocked: boolean;
}

/**
 * Information about when to override normal API caching when re-evaluating a
 * TRL string.
 */
export class CacheOverrideInfo {
    /**
     * Overrides normal API caching for region primitives when re-evaluating a
     * TRL string.
     */
    overrideRegions?: boolean;
    /**
     * Overrides normal API caching for tags primitives when re-evaluating a
     * TRL string.
     */
    overrideTags?: boolean;
    /**
     * Overrides normal API caching for wa primitives when re-evaluating a
     * TRL string.
     */
    overrideWa?: boolean;
    /**
     * Overrides normal API caching for new primitives when re-evaluating a
     * TRL string.
     */
    overrideNew?: boolean;
    /**
     * Overrides normal API caching for refounded primitives when re-evaluating
     * a TRL string.
     */
    overrideRefounded?: boolean;
    /**
     * Overrides normal API caching for categories primitives when
     * re-evaluating a TRL string.
     */
    overrideCategories?: boolean;
    /**
     * Overrides normal API caching for census primitives when re-evaluating a
     * TRL string.
     */
    overrideCensus?: boolean;
}

/**
 * Sends telegrams to a specified list of recipients using the
 * NationStates API.
 */
export class NsTgApi {
    private _api: NsApi;
    private _clientKey: string;

    private _onJobStart: (jobId: string) => void;
    private _onTgSuccess: (recipient: Recipient) => void;
    private _onTgFailure: (recipient: Recipient) => void;
    private _onJobComplete: (jobId: string) => void;

    private readonly _tgJobs: {[id: string]: TelegramJob};
    private readonly _tgQueue: Recipient[];
    private readonly _tgInterval: any;
    private _tgInProgress: boolean;

    private readonly _tgContinuousInterval: any;
    private _continuousDelaySecs: number;
    private _continuousCacheOverrideInfo: CacheOverrideInfo;

    private _blockExistingTelegrams: boolean;
    private _blockNewTelegrams: boolean;
    private _cleanup: boolean;

    private _jobIdCounter: number;

    /**
     * Initializes a new instance of the TelegramApi class.
     *
     * @param api The NationStates API instance used by this API. Only this API
     *            should use this instance.
     * @param clientKey The telegram client key used by this API.
     * @param continuousDelaySecs The delay between re-evaluations of the TRL
     *                            string for a continuous job in seconds.
     *                            Defaults to 60.
     * @param continuousCacheOverrideInfo Rules for when to override API caching
     *                                    when re-evaluating a TRL string in
     *                                    continuous mode. By default, all
     *                                    primitives override caches except
     *                                    categories and census.
     */
    constructor(api: NsApi, clientKey: string,
                continuousDelaySecs: number = 60,
                continuousCacheOverrideInfo: CacheOverrideInfo = {
                    overrideRegions: true,
                    overrideTags: true,
                    overrideWa: true,
                    overrideNew: true,
                    overrideRefounded: true,
                    overrideCategories: false,
                    overrideCensus: false
                })
    {
        this._api = api;
        this._clientKey = clientKey;

        this._onJobStart = () => {
        };
        this._onTgSuccess = () => {
        };
        this._onTgFailure = () => {
        };
        this._onJobComplete = () => {
        };

        this._tgJobs = {};
        this._tgQueue = [];
        this._tgInterval = setInterval(() => {
            if (this.tgInProgress
                || this._tgQueue.length === 0
                || this._blockExistingTelegrams)
            {
                return;
            }

            const recipient = this._tgQueue.shift()!;
            this._tgInProgress = true;
            this.sendTelegram(recipient);
        }, 0);
        this._tgInProgress = false;

        this._continuousDelaySecs = continuousDelaySecs;
        this._tgContinuousInterval = setInterval(() => {
            if (this._blockNewTelegrams) {
                return;
            }

            for (const jobId in this._tgJobs) {
                if (this._tgJobs.hasOwnProperty(jobId)) {
                    const job = this._tgJobs[jobId];
                    if (job.isContinuous && !job.status.isComplete) {
                        getRecipients(this.api, job.trl,
                                      this.continuousCacheOverrideInfo)
                            .then(nations => {
                                const recipients = nations.filter(nation => {
                                    for (const recipient of job.recipients) {
                                        if (recipient.nation === nation) {
                                            return false;
                                        }
                                    }
                                    return true;
                                }).map(nation => Object.freeze(
                                    {nation, jobId, status: {}}));
                                for (const recipient of recipients) {
                                    job.recipients.push(recipient);
                                    this._tgQueue.push(recipient);
                                }
                            });
                    }
                }
            }
        }, this.continuousDelaySecs * 1000);
        this.continuousCacheOverrideInfo = continuousCacheOverrideInfo;

        this._blockExistingTelegrams = false;
        this._blockNewTelegrams = false;
        this._cleanup = false;

        this._jobIdCounter = 1;
    }

    /**
     * Gets the NationStates API instance used by this API.
     */
    get api() {
        return this._api;
    }

    /**
     * Gets the telegram client key used by this API.
     */
    get clientKey() {
        return this._clientKey;
    }

    /**
     * Gets the event handler called when the API begins sending telegrams for
     * a particular job.
     */
    get onJobStart() {
        return this._onJobStart;
    }

    /**
     * Sets the event handler called when the API begins sending telegrams for
     * a particular job.
     *
     * @param onStart The new event handler.
     */
    set onJobStart(onStart: (jobId: string) => void) {
        this._onJobStart = onStart;
    }

    /**
     * Gets the event handler called when the API successfully sends a telegram
     * to a recipient.
     */
    get onTgSuccess() {
        return this._onTgSuccess;
    }

    /**
     * Sets the event handler called when the API successfully sends a telegram
     * to a recipient.
     *
     * @param onTgSuccess The new event handler.
     */
    set onTgSuccess(onTgSuccess: (recipient: Recipient) => void)
    {
        this._onTgSuccess = onTgSuccess;
    }

    /**
     * Gets the event handler called when the API fails to send a telegram
     * to a recipient.
     */
    get onTgFailure() {
        return this._onTgFailure;
    }

    /**
     * Sets the event handler called when the API fails to send a telegram
     * to a recipient.
     *
     * @param onTgFailure The new event handler.
     */
    set onTgFailure(onTgFailure: (recipient: Recipient) => void)
    {
        this._onTgFailure = onTgFailure;
    }

    /**
     * Gets the event handler called when the API finishes sending telegrams for
     * a particular job.
     */
    get onJobComplete() {
        return this._onJobComplete;
    }

    /**
     * Sets the event handler called when the API finishes sending telegrams for
     * a particular job.
     *
     * @param onJobComplete The new event handler.
     */
    set onJobComplete(onJobComplete: (jobId: string) => void) {
        this._onJobComplete = onJobComplete;
    }

    /**
     * Gets the delay between re-evaluations of the TRL string for a continuous
     * job in seconds.
     */
    get continuousDelaySecs() {
        return this._continuousDelaySecs;
    }

    /**
     * Gets the rules associated with overriding API caching when
     * re-evaluating a TRL string in continuous mode.
     */
    get continuousCacheOverrideInfo() {
        return this._continuousCacheOverrideInfo;
    }

    /**
     * Sets the rules associated with overriding API caching when
     * re-evaluating a TRL string in continuous mode.
     */
    set continuousCacheOverrideInfo(continuousCacheOverrideInfo: CacheOverrideInfo) {
        this._continuousCacheOverrideInfo = Object.freeze(
            continuousCacheOverrideInfo);
    }

    /**
     * Gets whether or not existing telegrams in the queue are blocked from
     * being sent.
     */
    get blockExistingTelegrams() {
        return this._blockExistingTelegrams;
    }

    /**
     * If set to true, blocks the API from sending any further telegrams. If
     * set to false, normal operation will resume.
     *
     * @param blockExistingTelegrams Whether or not existing telegrams in the
     *                               queue should be blocked from being sent.
     */
    set blockExistingTelegrams(blockExistingTelegrams: boolean) {
        this._blockExistingTelegrams = blockExistingTelegrams;
    }

    /**
     * Gets whether or not new telegrams are blocked from being added to the
     * queue.
     */
    get blockNewTelegrams() {
        return this._blockNewTelegrams;
    }

    /**
     * If set to true, prevents any new telegrams from being added to the queue.
     * If set to false, normal operation will resume.
     *
     * @param blockNewTelegrams Whether or not new telegrams should be blocked
     *                          from being added to the queue.
     */
    set blockNewTelegrams(blockNewTelegrams: boolean) {
        this._blockNewTelegrams = blockNewTelegrams;
    }

    /**
     * Gets whether or not this API is currently sending telegrams.
     */
    get tgInProgress() {
        return this._tgInProgress;
    }

    /**
     * Gets whether or not telegrams are queued.
     */
    get tgQueued() {
        return this._tgQueue.length !== 0;
    }

    /**
     * Cancels all requests in the API queue.
     */
    public clearQueue(): void {
        while (this._tgQueue.length > 0) {
            const recipient = this._tgQueue.pop()!;
            this.recipientFailure(recipient, new Error("API queue cleared"));
        }
    }

    /**
     * Cancels all requests in the telegram queue and turns off the API
     * scheduler.
     *
     * After this function is called, no further telegrams can be sent using
     * this API instance, including telegrams currently in the queue.
     */
    public cleanup(): void {
        clearInterval(this._tgInterval);
        clearInterval(this._tgContinuousInterval);

        this.clearQueue();
        this._cleanup = true;
    }

    /**
     * Gets the telegram job with the specified ID.
     *
     * @param id The telegram job ID.
     *
     * @return The telegram job with the specified ID.
     */
    public getJob(id: string): TelegramJob | undefined {
        return this._tgJobs[id];
    }

    /**
     * Cancels the job with the specified ID.
     *
     * @param id The ID of the job to cancel.
     */
    public cancelJob(id: string) {
        const job = this._tgJobs[id];
        if (typeof job !== "undefined") {
            for (const recipient of job.recipients) {
                if (typeof recipient.status.success === "undefined") {
                    recipient.status.success = false;
                    recipient.status.err = new Error("Job cancelled");

                    const index = this._tgQueue.indexOf(recipient);
                    if (index !== -1) {
                        this._tgQueue.splice(index, 1);
                    }
                }
            }
            job.status.isComplete = true;
        }
    }

    /**
     * Parses and evaluates a TRL string.
     *
     * @param trl A TRL string.
     *
     * @return A promise returning the nations represented by the specified TRL
     *         string.
     */
    public evaluateTrl(trl: string): Promise<string[]> {
        return getRecipients(this.api, trl);
    }

    /**
     * Sends telegrams to the recipients in the specified array.
     *
     * @param nations The nations to send the telegram to.
     * @param tgInfo Information about the telegram to send.
     *
     * @return A promise returning the ID of the telegram job associated with
     *         this request.
     */
    public sendTelegramsNations(nations: string[],
                                tgInfo: TelegramInfo): Promise<string>
    {
        return this.sendTelegramsTrl("nations [" + nations.join(",") + "];",
                                     tgInfo, false);
    }

    /**
     * Sends telegrams to the recipients defined by the specified template
     * recipient language string.
     *
     * @param trl The TRL string.
     * @param tgInfo Information about the telegram to send.
     * @param isContinuous Whether or not the TRL string should be continuously
     *                     re-evaluated and the new nations added to the queue.
     *                     Defaults to false.
     * @param isDryRun If true, no telegrams will be sent to nations. Defaults
     *                 to false.
     *
     * @return A promise returning the ID of the telegram job associated with
     *         this request.
     */
    public sendTelegramsTrl(trl: string, tgInfo: TelegramInfo,
                            isContinuous: boolean = false,
                            isDryRun: boolean = false): Promise<string>
    {
        return Promise.resolve().then(() => {
            if (this.blockNewTelegrams) {
                throw new Error("New telegram requests are being blocked")
            }
            if (this._cleanup) {
                throw new Error("API is shut down");
            }
            tgInfo = Object.freeze(clone(tgInfo));
            return this.createJob(trl, tgInfo, isContinuous,
                                  isDryRun)
                       .then(job => {
                           this._tgJobs[job.id] = job;
                           for (const recipient of job.recipients) {
                               this._tgQueue.push(recipient);
                           }
                           return job.id;
                       });
        });
    }

    /**
     * Creates a job with the specified parameters.
     *
     * @param trl The TRL string.
     * @param tgInfo Telegram information.
     * @param isContinuous Whether or not continuous mode is enabled.
     * @param isDryRun Whether or not dry run mode is enabled.
     *
     * @return A promise returning the created telegram job.
     */
    private createJob(trl: string, tgInfo: TelegramInfo,
                      isContinuous: boolean,
                      isDryRun: boolean): Promise<TelegramJob>
    {
        return Promise.resolve().then(() => {
            const jobId = String(this._jobIdCounter++);
            return getRecipients(this.api, trl)
                .then(nations => nations.map(nation => Object.freeze(
                    {nation, jobId, status: {}})))
                .then(recipients => {
                    if (recipients.length === 0 && !isContinuous) {
                        throw new Error("No recipients in job");
                    }
                    return Object.freeze(
                        {
                            id: jobId,
                            trl,
                            recipients,
                            tgInfo,
                            isContinuous,
                            isDryRun,
                            status: {
                                isStarted: false,
                                isComplete: false
                            }
                        }
                    );
                });
        });
    }

    /**
     * Sends a telegram to the specified recipient.
     *
     * @param recipient The specified recipient.
     */
    private sendTelegram(recipient: Recipient): void {
        Promise.resolve()
               .then(() => {
                   const job = this.getJob(recipient.jobId);
                   if (typeof job === "undefined") {
                       throw new Error("Job does not exist");
                   }
                   if (!job.status.isStarted) {
                       job.status.isStarted = true;
                       this.onJobStart(job.id);
                   }

                   let promise = Promise.resolve();
                   if (job.tgInfo.doNotSendIfCampaignBlocked) {
                       promise = promise.then(
                           () => this.api.nationRequest(recipient.nation,
                                                        ["tgcancampaign"])
                                     .then(data => {
                                         if (data["tgcancampaign"] !== 1) {
                                             throw new Error(
                                                 "Nation has blocked campaign"
                                                 + " telegrams");
                                         }
                                     }));
                   }
                   if (job.tgInfo.doNotSendIfRecruitBlocked) {
                       promise = promise.then(
                           () => this.api.nationRequest(recipient.nation,
                                                        ["tgcanrecruit"])
                                     .then(data => {
                                         if (data["tgcanrecruit"] !== 1) {
                                             throw new Error(
                                                 "Nation has blocked"
                                                 + " recruitment telegrams");
                                         }
                                     }));
                   }
                   return promise.then(() => job);
               })
               .then(job => this.api.telegramRequest(this.clientKey,
                                                     job.tgInfo.telegramId,
                                                     job.tgInfo.telegramKey,
                                                     recipient.nation,
                                                     job.tgInfo.telegramType))
               .then(() => this.recipientSuccess(recipient))
               .catch(err => this.recipientFailure(recipient, err));
    }

    /**
     * Called when a telegram is sent successfully to the specified recipient.
     *
     * @param recipient The specified recipient.
     */
    private recipientSuccess(recipient: Recipient): void {
        this._tgInProgress = false;

        recipient.status.success = true;
        this.onTgSuccess(recipient);

        const job = this.getJob(recipient.jobId);
        if (job) {
            this.jobComplete(job);
        }
    }

    /**
     * Called when an attempt is made to send a telegram to the specified
     * recipient that fails.
     *
     * @param recipient The specified recipient.
     * @param err The error associated with the failure.
     */
    private recipientFailure(recipient: Recipient, err: any): void {
        this._tgInProgress = false;

        recipient.status.success = false;
        recipient.status.err = err;
        this.onTgFailure(recipient);

        const job = this.getJob(recipient.jobId);
        if (job) {
            this.jobComplete(job);
        }
    }

    /**
     * Called when a recipient entry in the queue is processed in order to
     * determine if a job is complete.
     *
     * @param job The job associated with the recipient.
     */
    private jobComplete(job: TelegramJob): void {
        if (!job.isContinuous) {
            for (const recipient of job.recipients) {
                if (typeof recipient.status.success === "undefined") {
                    return;
                }
            }
            job.status.isComplete = true;
            this.onJobComplete(job.id);
        }
    }
}
