---
sidebar_position: 2
title: Publish a GTFS-Realtime feed
description: "From vehicle positions in a query to a public GTFS-Realtime address a rider app can consume, with the validator standing between the two."
---

# Publish a GTFS-Realtime feed

You hold vehicle positions, and the software that wants them speaks
GTFS-Realtime. This page covers the distance between those two: a saved query,
a column mapping, a validated publish, and a public address that answers with
protobuf and needs no credential.

## What has to be true

A GTFS-Realtime feed extends a scheduled one. Consumers, and the validator this
instance runs, read your realtime feed *against* your static GTFS archive, so a
`trip_id` in a realtime message means nothing unless a trip by that id exists in
the schedule.

So before anything else, know the URL of your static GTFS feed and be confident
it is current. See [your static feed is a
dependency](#your-static-feed-is-a-dependency) below for what rests on it.

For the feed itself, `vehicle_id`, `latitude` and `longitude` are required.
`trip_id`, `route_id`, `bearing`, `speed` and `timestamp` are optional. A feed
carrying only the three required fields is valid, but most rider apps will do
very little with it, so include `trip_id` and `timestamp` at least.

## Before you start

- A query whose results are one row per vehicle, which has run at least once. A
  query that has never run has no columns to map, and while the form will let
  you save a mapping in that state, nothing has checked it.
- An administrator account. Reading the feed list is open to any member;
  creating, editing, deleting and publishing take an admin, and the API returns
  403 regardless of what the interface shows.
- A validator. `VEODYN_FEED_VALIDATOR_URL` has to name the running validator
  service. Left unset, every publish attempt fails closed and is recorded as
  `failed`. See [Configuration](/configuration#sidecar-api).

## The steps

### 1. Get positions into a query

Positions usually arrive in one of two shapes, and you can use both.

The first is your own warehouse. An AVL or CAD system writes somewhere, usually
a SQL database. Add it as a [data source](/admin/data-sources) and write the
query that returns the current position per vehicle. This is the common case,
and it gives you the most control over what the feed says.

The second is a feed you already consume. The `gtfs_realtime` connector reads
vehicle positions in either of the two shapes agencies publish them in: an HTTP
protobuf snapshot at an `http(s)://` URL, or a websocket JSON stream at a
`ws(s)://` one (see [Connectors](/connectors)). Republishing a feed you consume
has a guide of its own, [Take a feed back from a
vendor](/use-cases/take-back-a-vendor-feed).

Over the HTTP protobuf form the same connector also reads trip updates and
service alerts, which are separate URLs on the same data source, not separate
data sources. Trip updates are what an [on-time performance
board](/use-cases/on-time-performance) is computed from. Reading both entity
types works in a community build. Publishing them is a separate question, and
step 3 covers it.

### 2. Clean the result before you bind it

A feed you ingest is not always publishable as it stands. The publish path
refuses values the standard does not allow rather than passing them on, so one
stale or malformed row blocks the whole attempt.

Add a data source of type `results`, which runs SQL over the cached results of
other queries, and bind the feed to that instead:

```sql
SELECT vehicle_id, trip_id, route_id, latitude, longitude, bearing, speed, ts
FROM cached_query_7
WHERE latitude BETWEEN 32.5 AND 35.0
  AND longitude BETWEEN -119.0 AND -116.0
  AND ts > extract(epoch FROM now()) - 900
```

This is also where you drop vehicles that have gone quiet, clip positions to
your own service area, convert a unit, or join two AVL systems into one feed.
See [Normalizing before you
publish](/features/published-feeds#normalizing-before-you-publish).

### 3. Declare the feed

**Connect → Feeds → Publish a feed**, and fill in five parts:

![The Publish a Feed form: source, address, shape, the field-to-column mapping table, and the on-failure modes](/img/screenshots/connect-feed-new.png)

| Part | What to put in it |
|---|---|
| **Source** | The saved query from step 2 |
| **Address** | A slug that reads as a name: `vehicles-live`, not a number. Lowercase letters, digits and hyphens, 64 characters. It cannot be renamed later |
| **Visibility** | Public if riders' software should read it without a credential. Private means the address answers a token and nothing else, which is covered in [Distribute a feed to a named partner](/use-cases/feed-to-a-partner) |
| **Shape** | Standard `gtfs-rt`, version 2.0, entity `vehicle_positions`. That is the one entity a community build *publishes*. Publishing trip updates and service alerts takes the [enterprise](/editions) pack; reading them from another feed does not |
| **Mapping** | Each field of the standard against a column of your query's result, plus the static GTFS reference, which is required |

Then pick an on-failure mode. Read the two names carefully, because at serving
time they behave the opposite way round from how they sound:

- **Block** refuses to publish a bad read. The address keeps serving the last
  artifact that passed, with its original timestamp, for as long as that takes,
  and age alone never stops it.
- **Last known good** does the same and adds a maximum age. Past that age the
  address stops answering at all.

So `last_good`, despite the name, is the option that can take your feed dark.
Pick `block` when a consumer coping with stale data is better than a consumer
getting nothing, and `last_good` when serving hours-old positions would be worse
than silence. For vehicle positions silence is usually the better answer, with
the cap set at a few multiples of your publish interval.

### 4. Publish

Open the feed's page and press **Publish now**. The button is withheld in any
state where an attempt could not succeed, and a sentence says which state that
is: the query could not be read, it has no cached result, or it has produced
nothing newer than what is already being served.

### 5. Give consumers the address

```
GET /api/public/feeds/<slug>
```

It answers with raw GTFS-Realtime bytes as `application/x-protobuf` and takes no
credential, since most software speaking this format will never hold one.

Two things to tell whoever consumes it:

- Everything the endpoint refuses answers the same 404 with the same body. An
  unknown slug, a private feed and a feed that has never published clean are
  indistinguishable from outside.
- Under `last known good`, once the artifact is older than the cap the endpoint
  answers 503 with a `Retry-After` carrying that cap. That value is the feed's
  configured staleness tolerance and says nothing about when the next publish
  lands.

### 6. Keep it publishing

A community build publishes when an administrator presses the button. An
[enterprise](/editions) build runs a worker beside the API, and the feed's page
carries an **Automatic publishing** panel offering every minute, five, fifteen,
hourly or daily. See [Publishing on a
cadence](/features/published-feeds#publishing-on-a-cadence).

## How you know it worked

Three checks, in increasing order of how much they prove.

First, the header says Serving, which means the bytes at that address came from
an attempt that published.

Second, the publish history has no findings you have not read. A published
attempt still lists what the validator said, under *Warnings the feed published
with*. Those warnings are where a slow drift out of conformance shows up, well
before it becomes an error.

Third, read it from outside. The first two checks cover your own instance; this
one covers the network between it and a rider's phone:

```bash
curl -sI https://your-node.example.gov/api/public/feeds/vehicles-live
```

A `200` with `content-type: application/x-protobuf` means the address is
reachable and answering with a feed. A `404` from outside, on a slug you can see
serving inside, is a hosting or proxy problem rather than a publishing one.
Since every refusal answers the same 404, the status line will not say which
one; the feed's own page will.

## Your static feed is a dependency

The validator fetches and prepares the static GTFS archive named in the binding,
then checks your realtime bytes against it. That puts the archive's availability
directly in the publish path:

| What happened to the static feed | What happens to this feed |
|---|---|
| The URL moved, or started 404ing | The prepare fails, the attempt is recorded, and nothing new publishes |
| It is stale, describing last quarter's service | Publishes carry conformance findings about trips and stops that no longer match |
| It got much larger | The first prepare after a change is slow, and a publish attempt can hit it |

A service change therefore has two parts: the schedule changes, and this feed
starts being checked against a different archive on the next publish. Watch the
publish history across a service change rather than assuming it rode through.

You can check the archive itself before binding anything to it. The same
validator service that checks your realtime bytes answers a second route,
`POST /validate-static`, which runs
[`gtfs-validator`](https://github.com/veodyn/gtfs-validator), our own pure-Python
reimplementation of the canonical rule set, over a static archive on its own
merits. There is no screen for it in the product; an operator calls the service
directly. [Query a static GTFS
archive](/use-cases/static-gtfs-archive#check-the-archive-before-you-rely-on-it)
covers what it takes and what it hands back.

## What takes it off the air

| What happened | What consumers see |
|---|---|
| No validator configured | Nothing ever publishes. Every attempt is recorded `failed`, which is the intended behaviour rather than a misconfiguration to work around |
| You edited a live feed | The feed goes dark until a new attempt succeeds. The button reads **Save and republish** and a confirmation states that consequence |
| The artifact aged past the cap under `last known good` | 503 with `Retry-After` |
| You deleted the feed | 404, indistinguishable from a slug that never existed. There is no undo |
| The bound query stopped running | The last good artifact keeps serving under `block`, indefinitely. [Schedules](/features/schedules) and this feed's own publish history are where that shows; [Captures](/features/captures) shows it too, but only if the bound query's source has historical capture switched on |

Serialization always runs before validation, so a column mapped to the wrong
thing is reported as a mapping defect rather than surfacing as a conformance
rule about a trip id that does not exist.
