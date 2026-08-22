---
sidebar_position: 3
title: Publish a GBFS feed
description: "Turning station or vehicle data into a whole GBFS system at a public address: the two vocabularies, the system facts, whole-system validation, and the member files a consumer reads."
---

# Publish a GBFS feed

Bikeshare and scooter programs are usually asked for GBFS by two audiences at
once: the city that issued the permit, and the aggregators and trip planners
riders actually use. Both need the same thing, a discovery document at a stable
URL with current member files under it. This page covers getting from a query
to that.

## What has to be true

A GBFS feed is a set of files. The address you hand out answers with
`gbfs.json`, the discovery document, and that document names the member files
underneath it. A publish attempt validates the whole system against the
version's JSON Schemas before anything is served, and GBFS findings are always
blocking.

Two versions are available, `2.3` and `3.0`. If your permit or your consumer
names one, pick that. Otherwise pick the version your largest consumer reads
today, and plan to publish the other later.

### Which vocabulary you are mapping

The form asks for a shape before it asks for a mapping, and the shape
determines which field list you see. Both shapes ship in a community build.

Stations, for a docked system: one row per station. The required list is
longer than GTFS-Realtime's, mostly because station status carries several
booleans a rider app has to be able to trust.

| Required | Optional |
|---|---|
| `station_id`, `name`, `lat`, `lon` | `num_docks_available` |
| `num_vehicles_available`, `last_reported` | `capacity` |
| `is_installed`, `is_renting`, `is_returning` | `address` |

You map that as one list. The split into `station_information` and
`station_status` happens automatically.

Vehicles, for a free-floating system: one row per vehicle. The list is
shorter, since a free-floating vehicle has no dock state to report.

| Required | Optional |
|---|---|
| `vehicle_id`, `lat`, `lon` | `current_range_meters` |
| `is_reserved`, `is_disabled`, `last_reported` | |

A field outside the shape's list is refused rather than skipped silently.

## Before you start

- A query returning one row per station, or one row per vehicle for a
  free-floating system, which has run at least once.
- An administrator account, since publishing is administered.
- The system facts, which no query returns and which you type into the form:
  a system id, a language, a display name and a timezone. On 3.0, also opening
  hours and a contact email. These are published as `system_information.json`.

## The steps

### 1. Normalize before you bind

Skipping this step costs more in GBFS than elsewhere, because a single bad row
blocks the entire system instead of degrading one file.

For example, a station whose `last_reported` sits below the earliest timestamp
GBFS accepts blocks the whole publish, and the reason names the row. Source
systems write values like that without complaint, but the standard rejects
them.

Add a data source of type `results` and bind the feed to a query over the
cached results of your connector read:

```sql
SELECT station_id, name, lat, lon,
       num_bikes_available, num_docks_available,
       is_installed, is_renting, is_returning,
       last_reported
FROM cached_query_7
WHERE last_reported >= 1450155600
  AND lat IS NOT NULL
  AND lon IS NOT NULL
```

The same query is where you drop stations that are out of service, join a name
table the upstream feed omits, convert a unit, or combine two systems into one
published feed. See [Normalizing before you
publish](/features/published-feeds#normalizing-before-you-publish).

A free-floating query works the same way over a different table: one row per
vehicle, with the vehicles that have gone quiet filtered out before they reach
the mapping.

### 2. Declare the feed

**Connect → Feeds → Publish a feed**. Source is the query above. The slug
becomes the feed's address, so pick something a permit officer can read back
over the phone: `bikeshare-gbfs` rather than `feed2`. It cannot be renamed
later.

Visibility has to be **Public** for a permit or an aggregator to read it. A
public slug is claimed across the whole instance rather than within your org,
and requesting one another tenant already holds is refused with a 409 that does
not say who holds it.

Under Shape, choose standard `gbfs`, then the version, then `stations` or
`vehicles`. Fill in the system facts. Then map the fields for the shape you
picked against your query's columns. Missing required fields are named when you
submit, and the list updates as you map them.

### 3. Pick an on-failure mode

**Block** keeps serving the last artifact that passed, however old it gets.
**Last known good** adds a maximum age, past which the address stops answering.

For a permit feed, consider which failure the city would rather see. A station
list that is a day stale still describes a real system, while a `503` looks
like the feed is down. Most operators pick `block` here and watch freshness
separately, which is the opposite of the advice for [vehicle
positions](/use-cases/publish-gtfs-realtime).

### 4. Publish, and read what came back

**Publish now** runs a single attempt. A blocked attempt lists the validator's
findings grouped by rule, with the individual locators behind a disclosure, so
forty rows from one broken rule do not read as forty separate problems.

![A feed's page: Serving in the header, the public address, the binding, and a publish history holding a published attempt and a blocked one](/img/screenshots/connect-feed-detail.png)

Where a rule reports more occurrences than it exported, the disclosure says
*showing 2 of 12 occurrences* rather than presenting the visible count as the
total.

### 5. Hand out the address

```
GET /api/public/feeds/<slug>
```

That answers with the discovery document. Which member files it names depends on
the shape you published.

A `stations` feed:

```
/api/public/feeds/<slug>/station_information.json
/api/public/feeds/<slug>/station_status.json
/api/public/feeds/<slug>/system_information.json
```

A `vehicles` feed writes no station file, and its status file is named
differently in each version, because 3.0 renamed the file, the data key inside
it and the id field together:

```
/api/public/feeds/<slug>/free_bike_status.json    # 2.3
/api/public/feeds/<slug>/vehicle_status.json      # 3.0
/api/public/feeds/<slug>/system_information.json
```

Give the permit office and every aggregator the discovery URL rather than a
member file. Consumers that follow the discovery document pick up files you add
later without re-registering, and they do not hardcode the 2.3 spelling of a
file you may publish as 3.0.

## How you know it worked

There is no need to re-check conformance. The attempt could not have published
without passing whole-system validation, and the feed's page carries the verdict
and every finding. Running another validator over the same bytes only confirms
that two validators agree.

What is worth checking is whether the feed is reachable from outside the
instance. Follow the discovery document the way an aggregator would:

```bash
curl -s https://your-node.example.gov/api/public/feeds/bikeshare-gbfs
curl -s https://your-node.example.gov/api/public/feeds/bikeshare-gbfs/station_status.json
```

The first answers with `gbfs.json` naming the member files, and the second is
one of them. If the discovery document resolves from outside your network and
the file it names resolves too, a consumer can read your system. A failure at
this point points at hosting rather than at the feed itself.

Then have the permit office or the aggregator confirm they can read it before
you write the URL into anything.

## What takes it off the air

| What happened | What consumers see |
|---|---|
| A row the standard rejects | Nothing publishes. The last clean artifact keeps serving, and the attempt names the row |
| You edited the live feed | Dark until a new attempt succeeds. The confirmation says so before you commit |
| The artifact aged past the cap under `last known good` | 503 with `Retry-After` |
| A member file the version requires is not in your mapping | The publish is blocked rather than partially served |

## What this does not cover

Vehicle types are not covered. Nothing here writes `vehicle_types.json`, so
`vehicle_type_id` is not a field you can map, and a mixed fleet of bikes,
e-bikes and scooters publishes as one undifferentiated list of vehicles. Raise
that with the permit office before you commit to a date.

Reading another operator's system goes the other way and uses a connector: the
[GBFS connector](/connectors) takes a discovery URL and returns station
information and status from it.
