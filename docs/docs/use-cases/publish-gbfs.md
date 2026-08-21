---
sidebar_position: 3
title: Publish a GBFS feed
description: "Turning station or vehicle data into a whole GBFS system at a public address: the two vocabularies, the system facts, whole-system validation, and the member files a consumer reads."
---

# Publish a GBFS feed

Bikeshare and scooter programs are usually asked for GBFS by two audiences at
once: the city that issued the permit, and the aggregators and trip planners
riders actually use. Both want the same thing, a discovery document at a stable
URL with current member files under it. This walks from a query to exactly that.

## What has to be true

GBFS is not one file, it is a system. The address you hand out answers with
`gbfs.json`, the discovery document, and that document names the member files
underneath it. A publish attempt validates the whole system against the
version's JSON Schemas before anything is served, and GBFS findings are always
blocking. A GBFS feed publishes clean or it does not publish.

Two versions are offered, `2.3` and `3.0`. If your permit or your consumer names
one, pick that. If nobody has said, pick the one your largest consumer reads
today and plan to publish the other later rather than guessing.

### Which vocabulary you are mapping

The form asks for a shape before it asks for a mapping, and the shape decides
which field list you see. Both ship in a community build.

Stations, for a docked system: one row per station. The required list is
longer than GTFS-Realtime's, because station status is mostly booleans a rider
app has to be able to trust.

| Required | Optional |
|---|---|
| `station_id`, `name`, `lat`, `lon` | `num_docks_available` |
| `num_vehicles_available`, `last_reported` | `capacity` |
| `is_installed`, `is_renting`, `is_returning` | `address` |

You map that as one list. The split into `station_information` and
`station_status` happens automatically.

Vehicles, for a free-floating system: one row per vehicle, and a shorter
list, because a loose scooter has no dock state to report.

| Required | Optional |
|---|---|
| `vehicle_id`, `lat`, `lon` | `current_range_meters` |
| `is_reserved`, `is_disabled`, `last_reported` | |

A field outside the shape's list is refused rather than quietly skipped, so a
mapping cannot publish a feed that is silently missing half of what you meant to
put in it.

## Before you start

- A query returning one row per station, or one row per vehicle for a
  free-floating system, which has run at least once.
- An administrator account, since publishing is administered.
- The system facts, which no query returns and which you type into the form:
  a system id, a language, a display name and a timezone. On 3.0, also opening
  hours and a contact email. These are published as `system_information.json`.

## The steps

### 1. Normalize before you bind

This is the step people skip, and GBFS is where skipping it hurts, because a
single bad row blocks the entire system instead of degrading one file.

The example to remember: a station whose `last_reported` sits below the
earliest timestamp GBFS accepts blocks the whole publish, and the reason names
the row. Source systems write values like that without complaint. The standard
does not take them.

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

The same seam drops stations that are out of service, joins a name table the
upstream feed omits, converts a unit, or combines two systems into one published
feed. See [Normalizing before you
publish](/features/published-feeds#normalizing-before-you-publish).

A free-floating query is the same idea over a different table: one row per
vehicle, with the vehicles that have gone quiet filtered out before they reach
the mapping.

### 2. Declare the feed

**Connect → Feeds → Publish a feed**. Source is the query above. The slug is the
feed's address and half its identity, so pick something a permit officer can read
back over the phone: `bikeshare-gbfs`, not `feed2`. It cannot be renamed later.

Visibility has to be **Public** for a permit or an aggregator to read it. A
public slug is claimed across the whole instance rather than within your org,
and taking one another tenant holds is refused with a 409 that does not say who
holds it.

Under Shape, choose standard `gbfs`, then the version, then `stations` or
`vehicles`. Fill in the system facts. Then map the fields for the shape you
picked against your query's columns. Missing required fields are named when you
submit, and the list updates as you map them.

### 3. Pick an on-failure mode

**Block** keeps serving the last artifact that passed, however old it gets.
**Last known good** adds a maximum age, past which the address stops answering.

For a permit feed, think about which failure the city would rather see. A
station list that is a day stale still describes a real system; a `503` is a
feed that is visibly down. Most operators pick `block` here and watch freshness
separately, the opposite of the advice for [vehicle
positions](/use-cases/publish-gtfs-realtime).

### 4. Publish, and read what came back

**Publish now** runs a single attempt. A blocked attempt lists the validator's
findings grouped by rule, with the individual locators behind a disclosure, so
one broken rule arriving as forty rows does not read as forty problems.

Where a rule reports more occurrences than it exported, the disclosure says
*showing 2 of 12 occurrences* instead of printing the visible count as if it
were the total.

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

A `vehicles` feed writes no station file at all, and its status file is named
differently in each version, since 3.0 renamed the file, the data key inside it
and the id field together:

```
/api/public/feeds/<slug>/free_bike_status.json    # 2.3
/api/public/feeds/<slug>/vehicle_status.json      # 3.0
/api/public/feeds/<slug>/system_information.json
```

Give the permit office and every aggregator the discovery URL, never a member
file. The discovery document is what lets you add files later without anyone
re-registering anything, and it is also what saves a consumer from hardcoding
the 2.3 spelling of a file you may later publish as 3.0.

## How you know it worked

Conformance is already settled: the attempt could not have published without
passing whole-system validation, and the feed's page carries the verdict and
every finding. There is nothing to re-check on that front, and re-running a
validator over bytes this instance just validated proves only that both agree.

What is worth checking is the part outside the instance. Follow the discovery
document the way an aggregator will:

```bash
curl -s https://your-node.example.gov/api/public/feeds/bikeshare-gbfs
curl -s https://your-node.example.gov/api/public/feeds/bikeshare-gbfs/station_status.json
```

The first answers with `gbfs.json` naming the member files; the second is one of
them. If the discovery document resolves from outside your network and the file
it names resolves too, a consumer can read your system. That is the failure this
check catches, and it is a hosting one rather than a feed one.

Then have the permit office or the aggregator confirm they can read it, before
you write the URL into anything.

## What takes it off the air

| What happened | What consumers see |
|---|---|
| A row the standard rejects | Nothing publishes. The last clean artifact keeps serving, and the attempt names the row |
| You edited the live feed | Dark until a new attempt succeeds. The confirmation says so before you commit |
| The artifact aged past the cap under `last known good` | 503 with `Retry-After` |
| A member file the version requires is not in your mapping | The publish is blocked, not partially served |

## What this does not cover

Vehicle types. Nothing here writes `vehicle_types.json`, so `vehicle_type_id` is
not a field you can map, and a mixed fleet of bikes, e-bikes and scooters
publishes as one undifferentiated list of vehicles. If your permit asks you to
distinguish them, that is the gap to raise before you commit to a date.

Reading somebody else's system is the other direction and is a connector, not a
published feed: the [GBFS connector](/connectors) takes a discovery URL and
returns station information and status from it.
