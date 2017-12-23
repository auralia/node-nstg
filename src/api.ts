/**
 * Copyright (C) 2016-2017 Auralia
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

import {getRecipients, ParseError, validateTrl} from "./trl";
import * as clone from "clone";
import {NsApi, TelegramType} from "nsapi";

export {ParseError};

/**
 * Represents a telegram job, which is a telegram combined with a set of
 * recipients for that telegram.
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
     * Whether the list of recipients should be refreshed by re-evaluating the
     * TRL string at periodic intervals.
     */
    refresh: boolean;
    /**
     * Rules for when to override API caching when re-evaluating a TRL string
     * during a refresh.
     */
    refreshOverrideCache: RefreshOverrideCache;
    /**
     * Whether to not actually send any telegrams to the specified recipients.
     */
    dryRun: boolean;
    /**
     * Information about the status of the job.
     */
    status: TelegramJobStatus;
}

/**
 * Represents the status of a telegram job.
 */
export interface TelegramJobStatus {
    /**
     * Whether at least one telegram associated with this job has been sent or
     * is in the process of being sent.
     */
    isStarted: boolean;
    /**
     * Whether there are no more telegrams that must be sent for this job.
     */
    isComplete: boolean;
}

/**
 * Represents a particular nation that will be the recipient of a telegram in
 * the context of a telegram job.
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
 * Represents a recipient's status in the context of a telegram job.
 */
export interface RecipientStatus {
    /**
     * Whether a telegram was successfully sent to the recipient. This value
     * will be undefined if no attempt to send a telegram was yet made.
     */
    success?: boolean;
    /**
     * Any error that occurred when trying to send a telegram to this recipient.
     */
    err?: any;
}

/**
 * Represents a particular telegram.
 */
export interface TelegramInfo {
    /**
     * The ID associated with this telegram.
     */
    telegramId: string;
    /**
     * The secret key associated with this telegram.
     */
    telegramKey: string;
    /**
     * The telegram type for rate limit purposes. Recruitment telegrams have a
     * stricter rate limit than non-recruitment telegrams.
     */
    telegramType: TelegramType;
    /**
     * Whether this telegram should not be sent to any nation with recruitment
     * telegrams blocked.
     */
    skipIfRecruitBlocked: boolean;
    /**
     * Whether this telegram should not be sent to any nation with campaign
     * telegrams blocked.
     */
    skipIfCampaignBlocked: boolean;
}

/**
 * Rules for when to override API caching when re-evaluating a TRL string
 * during a refresh.
 */
export class RefreshOverrideCache {
    /**
     * Whether to override API caching for regions primitives.
     */
    overrideRegions?: boolean;
    /**
     * Whether to override API caching for tags primitives.
     */
    overrideTags?: boolean;
    /**
     * Whether to override API caching for wa primitives.
     */
    overrideWa?: boolean;
    /**
     * Whether to override API caching for new primitives.
     */
    overrideNew?: boolean;
    /**
     * Whether to override API caching for refounded primitives.
     */
    overrideRefounded?: boolean;
    /**
     * Whether to override API caching for categories primitives.
     */
    overrideCategories?: boolean;
    /**
     * Whether to override API caching for census primitives.
     */
    overrideCensus?: boolean;
}

/**
 * Sends telegrams to a list of NationStates nations defined using a powerful
 * query language called Telegram Recipient Language.
 */
export class NsTgApi {
    private _api: NsApi;
    private _clientKey: string;

    private _onJobStart: (jobId: string) => void;
    private _onTgSuccess: (recipient: Recipient) => void;
    private _onTgFailure: (recipient: Recipient) => void;
    private _onJobComplete: (jobId: string) => void;
    private _onNewRecipients: (jobId: string, recipients: Recipient[]) => void;

    private readonly _tgJobs: { [id: string]: TelegramJob };
    private readonly _tgQueue: Recipient[];
    private readonly _tgInterval: any;
    private _tgInProgress: boolean;

    private readonly _tgRefreshInterval: any;
    private _refreshRateSecs: number;

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
     * @param refreshRateSecs The number of seconds between refreshes for a
     *                        telegram job with the refresh option enabled.
     *                        Defaults to 60.
     */
    constructor(api: NsApi, clientKey: string,
                refreshRateSecs: number = 60)
    {
        this._api = api;
        this._clientKey = clientKey;

        this._onJobStart = () => {
            /* Do nothing. */
        };
        this._onTgSuccess = () => {
            /* Do nothing. */
        };
        this._onTgFailure = () => {
            /* Do nothing. */
        };
        this._onJobComplete = () => {
            /* Do nothing. */
        };
        this._onNewRecipients = () => {
            /* Do nothing. */
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
            this.sendTelegramWithCallbacks(recipient);
        }, 0);
        this._tgInProgress = false;

        this._refreshRateSecs = refreshRateSecs;
        this._tgRefreshInterval = setInterval(() => {
            if (this._blockNewTelegrams) {
                return;
            }

            for (const jobId in this._tgJobs) {
                if (!this._tgJobs.hasOwnProperty(jobId)) {
                    continue;
                }

                const job = this._tgJobs[jobId];
                if (!job.refresh || job.status.isComplete) {
                    continue;
                }

                getRecipients(this.api, job.trl,
                              job.refreshOverrideCache)
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
                        if (recipients.length > 0) {
                            this._onNewRecipients(job.id, recipients);
                        }
                    });
            }
        }, this.refreshRateSecs * 1000);

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
     * Gets the event handler called when new recipients are added to a job.
     */
    get onNewRecipients() {
        return this._onNewRecipients;
    }

    /**
     * Sets the event handler called when new recipients are added to a job.
     *
     * @param onNewRecipients The new event handler.
     */
    set onNewRecipients(onNewRecipients: (jobId: string,
                                          recipients: Recipient[]) => void) {
        this._onNewRecipients = onNewRecipients;
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
     * Gets the number of seconds between refreshes for a telegram job with the
     * refresh option enabled.
     */
    get refreshRateSecs() {
        return this._refreshRateSecs;
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
            this.recipientFailure(recipient,
                                  new Error("API queue cleared"));
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
        clearInterval(this._tgRefreshInterval);

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
     * Throws an error if the specified TRL string is not valid.
     *
     * @param trl A TRL string.
     */
    public static validateTrl(trl: string): void {
        return validateTrl(trl);
    }

    /**
     * Parses and evaluates a TRL string.
     *
     * @param trl A TRL string.
     *
     * @return A promise returning the nations represented by the specified TRL
     *         string.
     */
    public async evaluateTrl(trl: string): Promise<string[]> {
        return await getRecipients(this.api, trl);
    }

    /**
     * Sends telegrams to the recipients defined by the specified template
     * recipient language string.
     *
     * @param trl The TRL string.
     * @param tgInfo Information about the telegram to send.
     * @param refresh Whether the list of recipients should be refreshed by
     *                re-evaluating the TRL string at periodic intervals.
     *                Defaults to false.
     * @param refreshOverrideCache Rules for when to override API caching when
     *                             re-evaluating a TRL string during a refresh.
     *                             By default, all primitives override caches
     *                             except categories and census.
     * @param dryRun Whether to not actually send any telegrams to the
     *               specified recipients. Defaults to false.
     *
     * @return A promise returning the ID of the telegram job associated with
     *         this request.
     */
    public async sendTelegramsTrl(trl: string, tgInfo: TelegramInfo,
                                  refresh: boolean = false,
                                  refreshOverrideCache: RefreshOverrideCache = {
                                      overrideRegions: true,
                                      overrideTags: true,
                                      overrideWa: true,
                                      overrideNew: true,
                                      overrideRefounded: true,
                                      overrideCategories: false,
                                      overrideCensus: false
                                  },
                                  dryRun: boolean = false): Promise<string>
    {
        if (this.blockNewTelegrams) {
            throw new Error("New telegram requests are being blocked")
        }
        if (this._cleanup) {
            throw new Error("API is shut down");
        }
        const _tgInfo = Object.freeze(clone(tgInfo));
        const job = await this.createJob(trl, _tgInfo, refresh,
                                         refreshOverrideCache, dryRun);
        this._tgJobs[job.id] = job;
        for (const recipient of job.recipients) {
            this._tgQueue.push(recipient);
        }
        return job.id;
    }

    /**
     * Creates a job with the specified parameters.
     *
     * @param trl The TRL string.
     * @param tgInfo Information about the telegram to send.
     * @param refresh Whether the list of recipients should be refreshed by
     *                re-evaluating the TRL string at periodic intervals.
     * @param refreshOverrideCache Rules for when to override API caching when
     *                             re-evaluating a TRL string during a refresh.
     * @param dryRun Whether to not actually send any telegrams to the
     *               specified recipients.
     *
     * @return A promise returning the created telegram job.
     */
    private async createJob(trl: string, tgInfo: TelegramInfo,
                            refresh: boolean,
                            refreshOverrideCache: RefreshOverrideCache,
                            dryRun: boolean): Promise<TelegramJob>
    {
        const jobId = String(this._jobIdCounter++);
        const nations = await getRecipients(this.api, trl);
        const recipients: Recipient[] = [];
        for (const nation of nations) {
            recipients.push(Object.freeze({nation, jobId, status: {}}));
        }
        if (recipients.length === 0 && !refresh) {
            throw new Error("No recipients in job");
        }
        return Object.freeze(
            {
                id: jobId,
                trl,
                recipients,
                tgInfo,
                refresh,
                refreshOverrideCache,
                dryRun,
                status: {
                    isStarted: false,
                    isComplete: false
                }
            }
        );
    }

    /**
     * Sends a telegram to the specified recipient.
     *
     * @param recipient The specified recipient.
     */
    private sendTelegramWithCallbacks(recipient: Recipient): void {
        this.sendTelegram(recipient)
            .then(() => this.recipientSuccess(recipient))
            .catch(err => this.recipientFailure(recipient, err));
    }

    /**
     * Sends a telegram to the specified recipient.
     *
     * @param recipient The specified recipient.
     */
    private async sendTelegram(recipient: Recipient): Promise<void> {
        const job = this.getJob(recipient.jobId);
        if (typeof job === "undefined") {
            throw new Error("Job does not exist");
        }
        if (!job.status.isStarted) {
            job.status.isStarted = true;
            this.onJobStart(job.id);
        }

        if (job.tgInfo.skipIfRecruitBlocked) {
            const data = await this.api.nationRequest(recipient.nation,
                                                      ["tgcanrecruit"]);
            if (data["tgcanrecruit"] !== 1) {
                throw new Error(
                    "Nation has blocked"
                    + " recruitment telegrams");
            }
        }
        if (job.tgInfo.skipIfCampaignBlocked) {
            const data = await this.api.nationRequest(recipient.nation,
                                                      ["tgcancampaign"]);
            if (data["tgcancampaign"] !== 1) {
                throw new Error(
                    "Nation has blocked campaign"
                    + " telegrams");
            }
        }

        if (job.dryRun) {
            return;
        }

        return await this.api.telegramRequest(this.clientKey,
                                              job.tgInfo.telegramId,
                                              job.tgInfo.telegramKey,
                                              recipient.nation,
                                              job.tgInfo.telegramType);
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
        if (!job.refresh) {
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
