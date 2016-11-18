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

import {Promise} from "es6-promise";
import {NsApi, WorldAssemblyCouncil, ApiError} from "nsapi";
import {CacheOverrideInfo} from "./api";

/**
 * Represents a directive to the TRL evaluator to take a particular action
 * with respect to a specified set of nations with respect to the nations
 * currently in that group.
 */
export interface RecipientCommand {
    /**
     * The action to take with respect to the specified nations.
     */
    action: Action;
    /**
     * The specified nations, given as a primitive or as a group.
     */
    recipients: RecipientPrimitive | RecipientCommand[];
    /**
     * A set of one-based indices that identify the location of the command
     * within the TRL string.
     *
     * For example, if the TRL string was "a; (b; c; (d; e;););", then the
     * position of command "a" is [1] while the position of command "e" is
     * [2, 3, 2].
     */
    position: number[];
}

/**
 * Represents a set of nations that meet some criteria defined by a specified
 * category and associated arguments.
 */
export interface RecipientPrimitive {
    /**
     * The category of the primitive.
     */
    category: string;
    /**
     * The category arguments of the primitive.
     */
    args: string[];
}

/**
 * Represents the action associated with a recipient command.
 */
export enum Action {
    /**
     * Add the recipients to the current group.
     */
    Add = 1,
        /**
         * Remove the recipients from the current group.
         */
    Remove = 2,
        /**
         * Remove all recipients from the current group that are not in this
         * list of recipients.
         */
    Limit = 3
}

/**
 * Error thrown during TRL parsing.
 */
export class ParseError extends Error {
    /**
     * The message associated with the error.
     */
    public message: string;
    /**
     * A set of one-based indices that identify the location of the command
     * that caused the error within the original TRL string.
     *
     * For example, if the TRL string was "a; (b; c; (d; e;););", then
     * [2, 3, 2] indicates that command "e" caused the error.
     */
    public position: number[];

    /**
     * Initializes a new instance of the ParseError class.
     *
     * @param message The message associated with the error.
     * @param position A set of one-based indices that identify the location of
     *                 the command that caused the error within the original
     *                 TRL string.
     */
    constructor(message: string, position: number[]) {
        super(message);
        this.message = message;
        this.position = position;
    }
}

/**
 * Parses and evaluates a TRL string using the specified API.
 *
 * @param api The specified API.
 * @param trl The specified TRL string.
 * @param continuousCacheOverrideInfo Rules for when to override API caching
 *                                    when re-evaluating a TRL string in
 *                                    continuous mode.
 *
 * @return A promise returning the nations represented by the specified TRL
 *         string.
 */
export function getRecipients(api: NsApi, trl: string,
                              continuousCacheOverrideInfo: CacheOverrideInfo = {}): Promise<string[]>
{
    return Promise.resolve().then(() => {
        return evaluateTrl(api, parseTrl(trl), continuousCacheOverrideInfo);
    });
}

/**
 * The current state of the TRL parser.
 */
interface ParseContext {
    /**
     * The portion of the string that has not yet been parsed.
     */
    s: string;
}

/**
 * Parses the specified TRL string into a list of recipient commands.
 */
function parseTrl(trl: string): RecipientCommand[] {
    return parseGroup({s: "(" + trl.trim() + ")"}, []);
}

/**
 * Parses the specified group string into a list of recipient commands.
 *
 * @param cxt The current parse context.
 * @param position The position of the specified group.
 *
 * @return A list of recipient commands.
 */
function parseGroup(cxt: ParseContext,
                    position: number[]): RecipientCommand[]
{
    cxt.s = cxt.s.trim();
    if (cxt.s.charAt(0) !== "(") {
        throw new ParseError("Expected '(' character", position);
    }
    cxt.s = cxt.s.substring(1);

    cxt.s = cxt.s.trim();
    const commands: RecipientCommand[] = [];
    for (let i = 1; cxt.s.charAt(0) !== ")"; i++) {
        commands.push(parseCommand(cxt, position.concat([i])));
        cxt.s = cxt.s.trim();
    }
    cxt.s = cxt.s.substring(1);
    cxt.s = cxt.s.trim();

    if (commands.length === 0) {
        throw new ParseError("Group must contain at least one"
                             + " command", position);
    }

    return commands;
}

/**
 * Parses the specified command string into a recipient command.
 *
 * @param cxt The current parse context.
 * @param position The position of the specified group.
 *
 * @return A recipient command.
 */
function parseCommand(cxt: ParseContext,
                      position: number[]): RecipientCommand
{
    cxt.s = cxt.s.trim();
    let action = Action.Add;
    if (cxt.s.charAt(0) === "+"
        || cxt.s.charAt(0) === "-"
        || cxt.s.charAt(0) === "/")
    {
        if (cxt.s.charAt(0) === "-") {
            action = Action.Remove;
        } else if (cxt.s.charAt(0) === "/") {
            action = Action.Limit;
        }
        cxt.s = cxt.s.substring(1);
    }

    cxt.s = cxt.s.trim();
    let recipients: RecipientPrimitive | RecipientCommand[];
    if (cxt.s.charAt(0) === "(") {
        recipients = parseGroup(cxt, position);
    } else {
        recipients = parsePrimitive(cxt, position);
    }

    cxt.s = cxt.s.trim();
    if (cxt.s.charAt(0) !== ";") {
        throw new ParseError("Expected ';' character", position);
    }
    cxt.s = cxt.s.substring(1);

    return {action, recipients, position};
}

/**
 * Parses the specified primitive string into a recipient primitive.
 *
 * @param cxt The current parse context.
 * @param position The position of the specified group.
 *
 * @return A recipient primitive.
 */
function parsePrimitive(cxt: ParseContext,
                        position: number[]): RecipientPrimitive
{
    cxt.s = cxt.s.trim();
    let category: string;
    let match = cxt.s.match(
        /^(nations|regions|tags|wa|new|refounded|census|categories)/);
    if (match) {
        category = match[0];
        cxt.s = cxt.s.substring(category.length);
    } else {
        throw new ParseError("Unrecognized category name", position);
    }

    cxt.s = cxt.s.trim();
    if (cxt.s.charAt(0) !== "[") {
        throw new ParseError("Expected '[' character", position);
    }
    cxt.s = cxt.s.substring(1);

    if (cxt.s.indexOf("]") === -1) {
        throw new ParseError("List of arguments must be terminated by ']'"
                             + " character", position);
    }

    const args = cxt.s
                    .substring(0, cxt.s.indexOf("]"))
                    .split(",")
                    .map(str => str.trim());

    if (category === "wa"
        && (args.length !== 1
            || (args[0] !== "members" && args[0] !== "delegates")))
    {
        throw new ParseError("Argument for 'wa' not 'members' or 'delegates'",
            position);
    }
    if (category === "new" && (args.length !== 1 || isNaN(parseInt(args[0])))) {
        throw new ParseError("Argument for 'new' not a number",
            position);
    }
    if (category === "refounded" && (args.length !== 1
                                     || isNaN(parseInt(args[0]))))
    {
        throw new ParseError("Argument for 'new' not a number",
            position);
    }
    if (category === "census"
        && (args.length !== 3
            || isNaN(parseInt(args[0]))
            || isNaN(parseInt(args[1]))
            || isNaN(parseInt(args[2]))))
    {
        throw new ParseError("Arguments for 'census' not three integers",
            position);
    }

    cxt.s = cxt.s.substring(
        cxt.s.indexOf("]") + 1);

    return {category, args};
}

/**
 * Evaluates the specified recipient commands using the specified API.
 *
 * @param api The specified API.
 * @param commands The specified recipient commands.
 * @param continuousCacheOverrideInfo Rules for when to override API caching
 *                                    when re-evaluating a TRL string in
 *                                    continuous mode.
 *
 * @return A promise returning the list of nations that the specified TRL string
 *         evaluates to.
 */
export function evaluateTrl(api: NsApi,
                            commands: RecipientCommand[],
                            continuousCacheOverrideInfo: CacheOverrideInfo): Promise<string[]>
{
    return evaluateGroup(api, commands, continuousCacheOverrideInfo).then(
        nations => nations
            .filter((nation, index) => nations.indexOf(nation) === index));
}

/**
 * Evaluates the specified group recipient commands using the specified API.
 *
 * @param api The specified API.
 * @param commands The specified recipient commands.
 * @param continuousCacheOverrideInfo Rules for when to override API caching
 *                                    when re-evaluating a TRL string in
 *                                    continuous mode.
 *
 * @return A promise returning the list of nations that the specified commands
 *         evaluate to.
 */
function evaluateGroup(api: NsApi,
                       commands: RecipientCommand[],
                       continuousCacheOverrideInfo: CacheOverrideInfo): Promise<string[]>
{
    let promise = Promise.resolve([]);
    for (const command of commands) {
        promise = promise.then(nations => evaluateCommand(
            api, command, nations, continuousCacheOverrideInfo));
    }
    return promise;
}

/**
 * Evaluates the specified recipient command using the specified API.
 *
 * @param api The specified API.
 * @param command The specified recipient command.
 * @param nations The list of nations in the current group.
 * @param continuousCacheOverrideInfo Rules for when to override API caching
 *                                    when re-evaluating a TRL string in
 *                                    continuous mode.
 *
 * @return A promise returning a new list of nations for the current group.
 */
function evaluateCommand(api: NsApi,
                         command: RecipientCommand,
                         nations: string[],
                         continuousCacheOverrideInfo: CacheOverrideInfo): Promise<string[]>
{
    if (command.recipients instanceof Array) {
        return evaluateGroup(api, command.recipients,
                             continuousCacheOverrideInfo).then(
            newNations => evaluateAction(command.action, nations, newNations));
    } else {
        return evaluatePrimitive(api, command.recipients, command.action,
                                 nations, continuousCacheOverrideInfo);
    }
}

/**
 * Evaluates the specified primitive with the specified action using the
 * specified API.
 *
 * @param api The specified API.
 * @param primitive The specified primitive.
 * @param action The specified action.
 * @param nations The nations associated with the current group.
 * @param continuousCacheOverrideInfo Rules for when to override API caching
 *                                    when re-evaluating a TRL string in
 *                                    continuous mode.
 *
 * @return A promise returning a new list of nations for the current group.
 */
function evaluatePrimitive(api: NsApi,
                           primitive: RecipientPrimitive,
                           action: Action,
                           nations: string[],
                           continuousCacheOverrideInfo: CacheOverrideInfo): Promise<string[]>
{
    if (primitive.category === "nations" || primitive.category === "regions"
        || primitive.category === "tags" || primitive.category === "wa"
        || primitive.category === "new" || primitive.category === "refounded")
    {
        let promise: Promise<[string]>;
        switch (primitive.category) {
            case "nations":
                promise = getNations(primitive.args);
                break;
            case "regions":
                promise = getRegions(
                    api, primitive.args,
                    continuousCacheOverrideInfo.overrideRegions);
                break;
            case "tags":
                promise =
                    getTags(api, primitive.args,
                            continuousCacheOverrideInfo.overrideTags);
                break;
            case "wa":
                if (primitive.args[0] === "members") {
                    promise =
                        getWorldAssemblyMembers(
                            api, continuousCacheOverrideInfo.overrideWa);
                } else {
                    promise = getWorldAssemblyDelegates(
                        api,
                        continuousCacheOverrideInfo.overrideWa);
                }
                break;
            case "new":
            {
                const count = parseInt(primitive.args[0]);
                promise = getNewNations(
                    api, count, continuousCacheOverrideInfo.overrideNew);
                break;
            }
            case "refounded":
            {
                const count = parseInt(primitive.args[0]);
                promise = getRefoundedNations(
                    api, count,
                    continuousCacheOverrideInfo.overrideRefounded);
                break;
            }
            default:
                throw new Error("Unexpected category");
        }
        return promise.then(newNations => evaluateAction(action, nations,
                                                         newNations));
    } else {
        let promise: Promise<string[]>;
        switch (primitive.category) {
            case "categories":
                promise = Promise.all(
                    nations.map(
                        nation => getCategory(
                            api, nation,
                            continuousCacheOverrideInfo.overrideCategories)
                            .then(category => {
                                if (primitive.args.indexOf(category) !== -1) {
                                    return nation;
                                } else {
                                    return "";
                                }
                            })
                            .catch(err => {
                                if (err instanceof ApiError) {
                                    if (err.responseText
                                        && err.responseText
                                              .indexOf("Unknown nation \""
                                                       + nation + "\"."))
                                    {
                                        return "";
                                    }
                                }
                                throw err;
                            })
                    )
                );
                break;
            case "census":
                promise = Promise.all(
                    nations.map(
                        nation => getCensusScore(
                            api, nation, primitive.args[0],
                            continuousCacheOverrideInfo.overrideCensus)
                            .then(score => {
                                if (score >= parseFloat(primitive.args[1])
                                    && score <= parseFloat(
                                        primitive.args[2]))
                                {
                                    return nation;
                                } else {
                                    return "";
                                }
                            })
                            .catch(err => {
                                if (err instanceof ApiError) {
                                    if (err.responseText
                                        && err.responseText
                                              .indexOf("Unknown nation \""
                                                       + nation + "\"."))
                                    {
                                        return "";
                                    }
                                }
                                throw err;
                            })
                    )
                );
                break;
            default:
                throw new Error("Unexpected category");
        }
        return promise.then(newNations => {
            newNations = newNations.filter(nation => nation !== "");
            switch (action) {
                case Action.Remove:
                    return nations.filter(
                        item => newNations.indexOf(item) === -1);
                case Action.Limit:
                    return newNations;
                default:
                    throw new Error("Unexpected action");
            }
        });
    }
}

/**
 * Evaluates the specified action with a list of the current nations in the
 * group and a list of the nations associated with the most recently processed
 * command.
 *
 * @param action The specified action.
 * @param nations The current nations in the group.
 * @param newNations The nations associated with the current command.
 *
 * @return The new list of nations for the current group.
 */
function evaluateAction(action: Action,
                        nations: string[],
                        newNations: string[]): string[]
{
    switch (action) {
        case Action.Add:
            return nations.concat(newNations);
        case Action.Remove:
            return nations.filter(
                item => newNations.indexOf(item) === -1);
        case Action.Limit:
            return nations.filter(
                item => newNations.indexOf(item) !== -1);
        default:
            throw new Error("Unrecognized action");
    }
}

/**
 * Gets a list of nations.
 *
 * @param args The list of nations in raw form.
 *
 * @return A promise returning the list of nations.
 */
function getNations(args: string[]): Promise<string[]> {
    return Promise.resolve(args.map(toId));
}

/**
 * Gets the nations in a list of regions using the specified API.
 *
 * @param api The specified API.
 * @param args The list of regions.
 * @param overrideCache Whether or not to override the cache for this request.
 *
 * @return A promise returning the list of nations.
 */
function getRegions(api: NsApi, args: string[],
                    overrideCache: boolean = false): Promise<string[]>
{
    return Promise.all(
        args.map(region => api.regionRequest(region, ["nations"], undefined,
                                             overrideCache)
                              .then(data => data["nations"].split(":")
                                                           .map(toId))))
                  .then(nationsInRegions => {
                      let nations: string[] = [];
                      for (const nationsInRegion of nationsInRegions) {
                          nations = nations.concat(nationsInRegion);
                      }
                      return nations;
                  });
}

/**
 * Gets the nations in all regions with the specified tags using the specified
 * API.
 *
 * @param api The specified API.
 * @param args The list of tags.
 * @param overrideCache Whether or not to override the cache for this request.
 *
 * @return A promise returning the list of nations.
 */
function getTags(api: NsApi, args: string[],
                 overrideCache: boolean = false): Promise<string[]>
{
    return api.worldRequest(["regionsbytag"],
                            {tags: args.join(",")}, overrideCache)
              .then(data => data["regions"].split(","))
              .then(regions => getRegions(api, regions, overrideCache));
}

/**
 * Gets all World Assembly member states using the specified API.
 *
 * @param api The specified API.
 * @param overrideCache Whether or not to override the cache for this request.
 *
 * @return A promise returning the list of nations.
 */
function getWorldAssemblyMembers(api: NsApi,
                                 overrideCache: boolean = false): Promise<string[]>
{
    return api.worldAssemblyRequest(
        WorldAssemblyCouncil.GeneralAssembly,
        ["members"],
        undefined,
        overrideCache
    ).then(data => data["members"].split(",")
                                  .map(toId));
}

/**
 * Gets all World Assembly delegates using the specified API.
 *
 * @param api The specified API.
 * @param overrideCache Whether or not to override the cache for this request.
 *
 * @return A promise returning the list of nations.
 */
function getWorldAssemblyDelegates(api: NsApi,
                                   overrideCache: boolean = false): Promise<string[]>
{
    return api.worldAssemblyRequest(
        WorldAssemblyCouncil.GeneralAssembly,
        ["delegates"],
        undefined,
        overrideCache
    ).then(data => data["delegates"].split(",")
                                    .map(toId));
}

/**
 * Gets the specified number of new nations using the specified API.
 *
 * @param api The specified API.
 * @param count The number of new nations to retrieve.
 * @param overrideCache Whether or not to override the cache for this request.
 *
 * @return A promise returning the list of nations.
 */
function getNewNations(api: NsApi, count: number,
                       overrideCache: boolean = false): Promise<string[]> {
    return api.worldRequest(["happenings"],
                            {filter: "founding", limit: String(count)},
                            overrideCache)
              .then(data => {
                  let event = data["happenings"]["event"];
                  if (!(event instanceof Array)) {
                      event = [event];
                  }
                  return event.filter(
                      (event: any) => event["text"].indexOf(
                          "was founded") !== -1)
              })
              .then(data => data.map(
                  (event: any) => {
                      const start = event["text"].indexOf("@@") + 2;
                      if (start !== -1) {
                          const end = start + event["text"].substring(start)
                                                           .indexOf("@@");
                          if (end !== -1) {
                              return event["text"].substring(start, end);
                          }
                      }
                      return "";
                  }))
              .then(data => data.filter((nation: string) => nation !== ""));
}

/**
 * Gets the specified number of refounded nations using the specified API.
 *
 * @param api The specified API.
 * @param count The number of refounded nations to retrieve.
 * @param overrideCache Whether or not to override the cache for this request.
 *
 * @return A promise returning the list of nations.
 */
function getRefoundedNations(api: NsApi, count: number,
                             overrideCache: boolean = false): Promise<string[]>
{
    return api.worldRequest(["happenings"],
                            {filter: "founding", limit: String(count)},
                            overrideCache)
              .then(data => {
                  let event = data["happenings"]["event"];
                  if (!(event instanceof Array)) {
                      event = [event];
                  }
                  return event.filter(
                      (event: any) => event["text"].indexOf(
                          "was refounded") !== -1)
              })
              .then(data => data.map(
                  (event: any) => {
                      const start = event["text"].indexOf("@@") + 2;
                      if (start !== -1) {
                          const end = start + event["text"].substring(start)
                                                           .indexOf("@@");
                          if (end !== -1) {
                              return event["text"].substring(start, end);
                          }
                      }
                      return "";
                  }))
              .then(data => data.filter((nation: string) => nation !== ""));
}

/**
 * Gets the category of the specified nation using the specified API.
 *
 * @param api The specified API.
 * @param nation The specified nation.
 * @param overrideCache Whether or not to override the cache for this request.
 *
 * @return A promise returning the list of nations.
 */
function getCategory(api: NsApi, nation: string,
                     overrideCache: boolean = false): Promise<string>
{
    return api.nationRequest(nation, ["category"], undefined, overrideCache)
              .then(data => data["category"]);
}

/**
 * Gets the score for the specified census ID for the specified nation using
 * the specified API.
 *
 * @param api The specified API.
 * @param nation The specified nation.
 * @param censusId The specified census ID.
 * @param overrideCache Whether or not to override the cache for this request.
 *
 * @return A promise returning the list of nations.
 */
function getCensusScore(api: NsApi, nation: string,
                        censusId: string,
                        overrideCache: boolean = false): Promise<number>
{
    return api.nationRequest(nation, ["census"], {scale: censusId},
                             overrideCache)
              .then(data => data["census"]["scale"]["score"]);
}

/**
 * Converts nation names to a fixed form: all lowercase, with spaces replaced
 * with underscores.
 *
 * @param nation The nation name to convert.
 *
 * @return The converted nation name.
 */
function toId(nation: string) {
    return nation.replace("_", " ").trim().toLowerCase().replace(" ", "_");
}
