---
sidebar_position: 15
title: Published Feeds
description: "Re-publishing a query's results as a standard GTFS-Realtime or GBFS feed: the binding form, validation, the publish history, and the anonymous address consumers read."
---

# Published Feeds

The other pages in this section are about getting data out of the instance in whatever shape your own tools want. This one goes the other way. It takes a saved query's results and serves them in a format other people's software already speaks, so a rider app or a downstream agency can consume them without knowing anything about Veodyn.

Today the formats are GTFS-Realtime 2.0 and GBFS (2.3 and 3.0). A published feed says that one query, mapped one particular way, is the source of one feed at one address.

It lives at **Connect → Published Feeds** in the sidebar (`/connect/feeds`).

## Publishing is administered

Any signed-in member can read the list. Creating, editing, deleting and publishing take an administrator, and the API enforces that on its own with a 403, whatever the interface shows.

A non-admin does not get those controls greyed out. They are gone, and one sentence sits where they would have been:

> Publishing is administered. An administrator declares what this instance serves.

A disabled button implies a permission you might get by asking, and a control that has simply vanished looks like a page that failed to load. The sentence is there to make the absence legible.

The permission line falls here because a published feed is an anonymous read surface over query results, so creating one changes both what data is exposed and who can reach it. Setting a [cadence expectation](/features/captures) on the Captures board is open to any member, since it changes neither.

## The list

![The published feeds list: address over source query, standard, access and revision](/img/screenshots/connect-feeds.png)

Four columns, and clicking a row opens that feed's page.

| Column | Holds |
|---|---|
| Address | The feed's slug, with the name of the query behind it underneath |
| Standard | `GTFS-Realtime 2.0 · vehicle positions`, or `GBFS 2.3 · stations` |
| Access | Public or Private |
| Revision | Which revision of the binding is current |

The Address column carries the source query's name as well as the slug, the same way Captures prints a capture over the connection it reads. A slug tells you what the feed is called; the second line tells you where its data comes from, without a click.

Search matches the slug, the query name and the visibility.

An empty list and a search that found nothing say different things (*No feeds are published yet* against *No published feed matches that search*), the same distinction the [catalog](/features/data-catalog#when-the-catalog-is-empty-or-unavailable) draws.

## Declaring a feed

**Publish a feed** opens a form in five parts. Wherever a closed set of values exists, the form offers exactly that set, so there is little here that the API can refuse later.

![The Publish a Feed form: source, address, shape, the field-to-column mapping table, and the on-failure modes](/img/screenshots/connect-feed-new.png)

### Source

Pick the saved query whose latest results become the feed. The picker searches every query you can open.

Switching to a different query clears the column mapping. A field mapped against one query's columns means nothing against another's, and carrying it over is how a form quietly submits a mapping full of columns that no longer exist. Re-picking the same query after pressing **Change** keeps the mapping, so opening the picker and closing it again costs you nothing.

#### Normalizing before you publish

An ingested feed is not always a publishable one. Values that a source system writes without complaint can still be outside what the standard allows, and a publish attempt refuses them rather than passing them on: a station whose `last_reported` sits below the earliest timestamp GBFS accepts blocks the whole attempt, and the reason names the row.

The fix is a query, not a setting. Add a data source of type `results`, which runs SQL over the cached results of other queries, point it at the connector read you already have, and bind the feed to that instead:

```sql
SELECT station_id, name, lat, lon, num_bikes_available, last_reported
FROM cached_query_7
WHERE last_reported >= 1450155600
```

The same seam handles the rest of it: dropping stations that are out of service, joining a name table the upstream feed omits, converting a unit, or combining two systems into one published feed. Whatever the query returns is what the mapping reads, so a feed is only ever as clean as the query behind it.

### Address

The slug is the feed's address and half its identity: `vehicles-live`, not a number. It takes lowercase letters, digits and hyphens, has to start with a letter or a digit, and runs to 64 characters.

One name is refused outright. `capabilities` is a real endpoint on the same collection, so a feed slugged that would sit at an address the API already answers on.

Visibility is two options:

| | Who can read it |
|---|---|
| Private | Only signed-in members of the org |
| Public | Anyone with the URL, no credential needed |

A public slug is claimed across the whole instance rather than within your org, because a public feed's address has no org segment in it. Taking one another tenant already holds is refused with a 409, and the refusal does not say who holds it, since that would turn the message into a cross-tenant directory. Pick another slug, or keep the feed private.

### Shape

Standard is a choice of two, `gtfs-rt` and `gbfs`. Version follows from it. GTFS-Realtime has one version, `2.0`, and it appears as a plain fact instead of a dropdown with one entry, since a control with a single choice invites you to click it and find out what else is in there. GBFS has two, `2.3` and `3.0`, so it gets a picker.

Entity is a fact or a picker, depending on what this deployment registered. A community build registers one entity under GTFS-Realtime, `vehicle_positions`, and shows it as a fact; under GBFS it registers two shapes, `stations` for a docked system and `vehicles` for a free-floating one, so that gets a picker. An [enterprise](/editions) build whose pack registers more widens the list. The form asks the running service what it holds instead of inferring it from a values file, and if that lookup is slow or fails it falls back to the single fact rather than showing an empty picker.

### Mapping

The column map puts each field the chosen standard needs against a column of the query's own result.

Missing required fields are named when you submit, and the list updates as you map them instead of freezing on whatever was missing the first time.

A query that has never run has no columns to offer. The table says so, instead of showing a column of dropdowns whose only selectable value is *Not mapped*. You can still save a mapping in that state, and the page tells you the catch: nothing has checked it.

#### GTFS-Realtime

A static GTFS reference, meaning the scheduled feed this realtime feed extends, is required.

| Field | Required |
|---|---|
| `vehicle_id`, `latitude`, `longitude` | Yes |
| `trip_id`, `route_id`, `bearing`, `speed`, `timestamp` | No |

#### GBFS

The shape picked above decides the vocabulary. For `stations`:

| Field | Required |
|---|---|
| `station_id`, `name`, `lat`, `lon` | Yes |
| `num_vehicles_available`, `is_installed`, `is_renting`, `is_returning`, `last_reported` | Yes |
| `num_docks_available`, `capacity`, `address` | No |

The mapped fields are split into `station_information` and `station_status` automatically, so you map them once as one list.

For `vehicles`:

| Field | Required |
|---|---|
| `vehicle_id`, `lat`, `lon` | Yes |
| `is_reserved`, `is_disabled`, `last_reported` | Yes |
| `current_range_meters` | No |

A vehicles feed publishes the discovery document, `system_information.json` and the version's own status file: `free_bike_status.json` on 2.3, `vehicle_status.json` on 3.0. No station file is written for it, and no `vehicle_types.json` either, so `vehicle_type_id` is not a field you can map yet.

#### System

A GBFS system also declares facts no query returns: a system id, a language, a display name and a timezone, and on 3.0 opening hours and a contact email. These are typed into the form and published as `system_information.json`.

### On failure

Two modes, and at serving time their names read backwards from what you might expect:

- **Block** refuses to publish a bad read. The feed keeps serving the last artifact that passed, with its original timestamp, for as long as that takes. Age alone never stops it.
- **Last known good** does the same, plus a required maximum age. Once the artifact is older than that, the address stops answering.

So the tolerant-sounding option is the one that can take a feed dark, because whoever picks it also has to say how stale is too stale. The age field only appears in that mode, since the API refuses a cap on `block` and requires one on `last_good`.

### What is checked when you save

The binding is validated before anything is written, so a refused save leaves the stored binding and whatever is currently being served untouched. The query has to exist and be readable, and the column map has to name columns its results actually have. A map that cannot produce the feed comes back with every problem named at once, while the person who wrote it is still looking at it.

A GBFS feed is validated as a whole system against the version's JSON Schemas before anything is served; a finding blocks the publish, and GBFS findings are always blocking, so a GBFS feed publishes clean or not at all.

## The feed's page

`/connect/feeds/<slug>` holds the whole record: what the feed is bound to, where it can be read, and every attempt to publish it.

![A feed's page: Serving in the header, the public address, the binding, and a publish history holding a published attempt and a blocked one](/img/screenshots/connect-feed-detail.png)

### Serving status

One word in the header for whether anything is being served right now.

| Status | Means |
|---|---|
| Serving | An attempt published, and its bytes are what the address answers with |
| Not serving | The newest attempt published, but an edit or a delete has since retired the declaration it answered for |
| Blocked | The validator refused the bytes |
| Failed | The attempt never reached a verdict |
| Never published | No attempt has been recorded |

Not serving is not a failure. That attempt produced bytes, they passed, and they were served; then something retired the binding underneath them. Labelling it *Failed* would put one decision on screen as another, three lines above a history that says *Published* about the same row.

This is serving state, not mapping state. The page will not tell you the binding is valid on a read, because the check that would establish that only runs on a write.

### Address

A public feed shows its full address with a copy button, and says that anyone can read it without a credential once an attempt has published.

A GBFS feed's address answers with the discovery document (`gbfs.json`); the member files it names sit underneath it, at `/api/public/feeds/<slug>/station_status.json` and its siblings, or the free-floating equivalents for a `vehicles` feed.

A private feed shows no address at all, and says why: reaching one takes an issued token, and the token model (issuance, rotation, revocation) has not been built. Printing a URL that refuses everything would only send someone hunting for a credential that does not exist.

:::note The token panel is a seam, not a feature

The page reserves a slot for a token panel to fill once one exists. Nothing fills it today in either edition, so the sentence above is what every build shows for a private feed.

:::

### Binding

The committed declaration read back: query, standard, version, entity, static GTFS reference, on-error mode with its cap, visibility, revision, and the full column map.

### Publish history

Every attempt the instance has recorded, newest first, with its decision, the binding revision it ran against, and a marker on whichever one is currently serving.

What appears under an attempt depends on the kind of answer it was:

- A blocked attempt lists the validator's findings, grouped by rule. The attempt's own reason is only a count ("2 conformance error(s)"), so the findings are the real explanation.
- A failed attempt has no findings, because nothing reached a verdict. Its one reason sentence is all there is.
- A published attempt lists findings too, where it has any, under *Warnings the feed published with*. A feed that published is not a feed with nothing to say about itself, and dropping the warnings at the point of success is how a slow drift out of conformance stays invisible until it turns into an error.

Findings group by rule, with the individual locators behind a disclosure, since one broken rule arriving as forty rows reads like forty problems.

:::note "showing 2 of 12 occurrences"

The validator caps how many occurrences it exports per rule while reporting the true total separately. Where the two differ, the disclosure says so. Printing the number of rows on screen as if it were the total would tell you two vehicles are broken when twelve are, which is worse than vague because it looks exact.

:::

### Publish now

An administrator can run a single attempt on demand.

The button is withheld in any state where an attempt could not succeed, and a sentence says which state that is:

| What is true | What the page says instead |
|---|---|
| The check is still running | *Checking whether this query has a result newer than the one being served.* |
| The query could not be read | *This query could not be read, so there is no telling whether publishing would serve anything new.* |
| The query has no cached result | *This query has no cached result, so there is nothing to publish.* |
| Its newest result is no newer than the serving one | *This query has produced nothing new since the last publish.* |

Each state gets its own sentence, because the page has established something different in each one.

### Editing takes the feed off the air

Saving an edit to a feed that is currently serving takes it dark until a new attempt succeeds, and the interface will not let that happen quietly:

- The submit button reads **Save and republish**, but only when the feed is actually live. On one that is already dark there is nothing to republish.
- A confirmation states the consequence: consumers of the address get nothing in the meantime.
- Confirming fires the update and then a publish attempt right away, instead of leaving the feed dark until some later cycle.

A refused save keeps every value on screen, so a rejection does not cost you the mapping you just built.

A slug cannot be renamed, since it is half the feed's identity. Publish a new feed to change it.

### Deleting

Delete asks for confirmation and says what it means: consumers of that address start getting nothing, a deleted slug looks the same as one that never existed, and there is no undo.

## How a consumer reads a public feed

`GET /api/public/feeds/<slug>` returns raw GTFS-Realtime bytes as `application/x-protobuf`. It is the only route in the sidecar's community surface that takes no credential, on the grounds that most software speaking this format will never hold one.

Everything it refuses answers the same 404, with the same body. An unknown slug, a slug naming a private feed, and a slug that has never published a clean attempt are indistinguishable from outside. Telling them apart would rebuild the probing oracle that a single 404 exists to close, letting a caller work out which slugs are taken, or merely dark, one guess at a time.

Staleness is the one exception, and only under last known good. Once the artifact is older than the configured cap, the endpoint answers 503 with a `Retry-After` carrying that cap instead of serving stale bytes.

Two details matter if you are consuming one:

- `Retry-After` is the feed's own age cap, not a prediction. The endpoint cannot know when the next publish will land. The cap is the only interval anyone has stated about this feed's tolerable staleness, so it is the one real number available.
- Age is measured from the artifact's own header timestamp, not from when the attempt was recorded. The header is what the served bytes tell a consumer the data's time is. Measuring our own pipeline instead would call a fresh publish of hours-old rows current.

Under block there is no staleness branch at all. Block governs whether a bad read gets published, and the engine settled that before those bytes ever became current.

## What community ships, and what it does not

### The validator

Conformance rules are not written here. They come from [`gtfs-rt-validator`](https://github.com/veodyn/gtfs-rt-validator), our own Python package, and `validator/` in the repository is a small HTTP wrapper around it that the sidecar calls over the network.

It runs as its own service for one reason. The validator loads the agency's static GTFS archive to check against, which costs roughly 48 seconds and holds about 584 MB per feed. In-process, every API replica would carry its own copy and pay that on a cold call. One service holding one prepared archive answers in about half a second, and that is what makes validation possible inside a publish request at all.

:::caution A deployment with no validator configured publishes nothing

`VEODYN_FEED_VALIDATOR_URL` names the service. Leave it unset and every publish attempt fails closed, recorded as a `failed` attempt.

This is the intended behaviour and not a misconfiguration to work around: an empty finding list from a validator that never answered looks exactly like a clean feed. See [Configuration](/configuration#sidecar-api).

:::

| | Community | Enterprise |
|---|:---:|:---:|
| Declaring, editing and deleting a feed | ● | ● |
| Publishing on demand, and the attempt history | ● | ● |
| Serving a public feed anonymously | ● | ● |
| `vehicle_positions` | ● | ● |
| Further entity types (trip updates, service alerts) | | ● |
| A worker that publishes on a schedule | | ● |

So a community build publishes when an administrator presses the button, and an enterprise one also publishes on a cadence of its own.

### Publishing on a cadence

An enterprise deployment runs a worker beside the API, and a feed's page carries an **Automatic publishing** panel. An administrator picks how often the feed republishes: every minute, every five, every fifteen, hourly, or daily. A minute is the floor, because that is how often the worker looks.

Each pass reads the bound query's newest cached result. When the query has produced nothing since the last publish, the pass records no attempt: the publish history stays a record of what was served, rather than a line per tick. A pass that fails backs the feed off, doubling from two minutes up to an hour, and the panel says how many failures have run together.

Turning it off leaves the feed as it is, still serving its last published artifact and still publishable by hand.

Downgrades fail closed rather than reinterpreting anything. A feed bound to an entity the current build no longer registers goes on showing the entity it was bound to, not a value invented from today's registry.

## Why a mapping fault is never reported as a data fault

Serialization always runs before validation. Hand the validator bytes built from a column mapped to the wrong thing and it answers with whatever conformance rule that happens to trip: a trip id that does not exist, a position outside the agency's bounding box. The operator then goes looking in the schedule for a fault that lives in the binding.

Building the bytes first means a mapping defect gets named as a mapping defect, and a verdict only ever describes bytes that exist.

Only a clean verdict moves the pointer. On any other decision the address carries on serving the last artifact that passed.
