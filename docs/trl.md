# Template Recipient Language #

Template Recipient Language (TRL) is a powerful query language that allows users to define and manipulate complex telegram mailing lists based on a variety of criteria, such as current region, WA membership and World Census statistics.

## Components ##

TRL strings are made up of three key components: primitives, commands, and groups.

### Primitives ###

A primitive specifies a particular group of nations based on certain criteria. These criteria can be something as simple as a nation's name to something as complex as whether or not a nation's region has a particular tag.

Primitives are of the form `<category> [<argument>, <argument>, ...]`. The available categories are:

* **nations**: Represents a simple list of nations (e.g. `nations [Auralia, Railana]`);
* **regions**: Represents all of the nations in a particular region or regions (e.g. `regions [the South Pacific]`);
* **tags**: Represents all of the nations in all regions with a particular tag or tags (e.g. `tags [Miniscule]`);
* **wa**: Represents all World Assembly members (e.g. `wa [members]`) or delegates (e.g. `wa [delegates]`);
* **new**: Represents a certain number of newly founded nations (e.g. `new [25]`);
* **refounded**: Represents a certain number of newly refounded nations (e.g. `refounded [10]`);
* **categories**: Represents nations with a particular World Assembly category or categories (e.g. `categories [Inoffensive Centrist Democracy, Anarchy]`);
* **census**: Represents nations with a census score that falls in a particular range (e.g. `census [50, 100, 500]` for nations with a Freedom of Taxation score (census ID 50) between 100 and 500).

Note that the categories and census primitives cannot be used with the add action of a command. (Commands are discussed in the following section.) This is because the NationStates API provides no mechanism to retrieve the nations that meet this criteria without making thousands of requests or using a daily data dump.

### Commands ###

A command is the combination of a primitive or a group with a particular action: add, remove, or limit. (Groups are simply sets of nations defined by a list of commands and will be discussed in further detail in the following section.)

Commands are of the form `<action> <primitive or group>;`. The available actions are

* add (`+`): Adds the recipients specified by the primitive or group to the list of nations of the current group (e.g. `+nations [North American Free Trade Agreement];` adds the nation "North American Free Trade Agreement" to the current group);
* remove (`-`): Removes the recipients specified by the primitive or group to the list of nations of the current group (e.g. `-regions [the Pacific];`, which removes all nations from the Pacific from the current group);
* limit (`/`): Removes all nations from the current group that are not specified by the primitive or group (e.g. `/wa [members];` removes all nations from the current group if they are not World Assembly members).

Commands must be terminated with a semicolon; this is not optional. However, Command actions are optional; the default action is add if none is specified.

### Groups ###

A group, like a primitive, specifies a particular set of nations. However, unlike a primitive, this set is defined by a sequence of commands which add and remove nations from other groups or primitives to or from this set.

An example of a group is `(+regions: [the South Pacific]; -nations [Raliana]; /wa [members];)`. This group represents all World Assembly member states in the South Pacific except Railana, a particular nation in the South Pacific.

This group can in turn be used in other commands to form larger groups. For example, the group `(+wa [members]; -(+regions [the South Pacific]; -nations [Raliana]; /wa [members];);)` represents all World Assembly members except for those World Assembly members in the South Pacific who are not Railana.

Note that all TRL strings consist of a single outermost group. The nations in this group constitute the actual mailing list; telegrams are sent only to the nations in this group.

Groups must be enclosed with parentheses; this is not optional. The sole exception is the outermost group, which must not be enclosed with parentheses.

## Examples ##

Here's a complex example of a TRL string:

```
regions [Catholic];
(regions [Testregionia];
 /wa [members];
 -nations [Testlandia];
);
(regions [the Pacific, the North Pacific, the South Pacific,
          the West Pacific, the East Pacific];
 /wa [delegates];
);
```

The outermost group of this TRL string consists of three commands which add:

* all nations in the region of Catholic,
* all World Assembly member nations in Testregionia except Testlandia, and
* the delegate of each feeder region

to the group.

## Specification ##

Unfortunately, there is no formal specification for TRL beyond the documentation above. However, there is also an augmented Backus-Naur Form (ABNF) grammar for TRL which you might find helpful:

```
translation-unit = group
group = command *(command)
command = [action] (inner-group | primitive) ";"
action = "+" | "-" | "/"
inner-group = "(" group ")"
primitive = category "[" arguments "]"
category = "nations" | "regions" | "tags" | "wa" | "new" | "refounded" | census" | "categories"
arguments = argument *("," argument)
argument = <any sequence of characters except ',' and ']'>
```

Note that whitespace between all tokens is ignored. Please see RFC 5234 for more information about ABNF.
