---
sidebar_position: 2
title: Publish a GTFS-Realtime feed
description: "From vehicle positions in a query to a public GTFS-Realtime address a rider app can consume, with the validator standing between the two."
---

# Publish a GTFS-Realtime feed

You hold vehicle positions. Somebody else's software speaks GTFS-Realtime. This
walks the whole distance between those two facts: a saved query, a column
mapping, a validated publish, and a public address that answers with protobuf
and needs no credential.

## What has to be true

A GTFS-Realtime feed is an extension of a scheduled one. Every consumer that
matters, and the validator this instance runs, reads your realtime feed
*against* your static GTFS archive: a `trip_id` in the realtime message means
nothing unless a trip by that id exists in the schedule.

So before anything else, know the URL of your static GTFS feed and be confident
it is current. It is not decoration on this page, it is a dependency: see [your
static feed is a dependency](#your-static-feed-is-a-dependency) below.

For the feed itself, `vehicle_id`, `latitude` and `longitude` are required.
`trip_id`, `route_id`, `bearing`, `speed` and `timestamp` are optional, and a
feed carrying only the three required fields is a valid feed that most rider
apps will do very little with. Aim for `trip_id` and `timestamp` at least.

## Before you start

- A query whose results are one row per vehicle, which has run at least once. A
  query that has never run has no columns to map, and while the form will let
  you save a mapping in that state, nothing has checked it.
- An administrator account. Reading the feed list is open to any member;
  creating, editing, deleting and publishing take an admin, and the API enforces
  that itself with a 403 whatever the interface shows.
- A validator. `VEODYN_FEED_VALIDATOR_URL` has to name the running validator
  service. Left unset, every publish attempt fails closed and is recorded as
  `failed`. See [Configuration](/configuration#sidecar-api).

## The steps

### 1. Get positions into a query

Two shapes are common, and they are not exclusive.

The first is your own warehouse. Your AVL or CAD system writes somewhere,
usually a SQL database. Add it as a [data source](/admin/data-sources) and write
the query that returns the current position per vehicle. This is the usual case,
and the one that gives you the most control over what the feed says.

The second is a feed you already consume. The `gtfs_realtime` connector reads
vehicle positions in either of the two shapes agencies publish them in: an HTTP
protobuf snapshot at an `http(s)://` URL, or a websocket JSON stream at a
`ws(s)://` one (see [Connectors](/connectors)). Republishing what you consume is
a real use case, covered on its own in [Take a feed back from a
vendor](/use-cases/take-back-a-vendor-feed).

Over the HTTP protobuf form the same connector also reads trip updates and
service alerts, which are separate URLs on the same data source, not separate
data sources. Trip updates are what an [on-time performance
board](/use-cases/on-time-performance) is computed from, and they are community:
ingesting those two entity types is not the same question as publishing them.

### 2. Clean the result before you bind it

An ingested feed is not always a publishable one. The publish path refuses
values the standard does not allow rather than passing them on, so a single
stale or malformed row blocks the whole attempt.

The fix is a query, not a setting. Add a data source of type `results`, which
runs SQL over the cached results of other queries, and bind the feed to that
instead:

```sql
SELECT vehicle_id, trip_id, route_id, latitude, longitude, bearing, speed, ts
FROM cached_query_7
WHERE latitude BETWEEN 32.5 AND 35.0
  AND longitude BETWEEN -119.0 AND -116.0
  AND ts > extract(epoch FROM now()) - 900
```

That seam is where you drop vehicles that have gone quiet, clip positions to
your own service area, convert a unit, or join two AVL systems into one feed.
See [Normalizing before you
publish](/features/published-feeds#normalizing-before-you-publish).

### 3. Declare the feed

**Connect → Feeds → Publish a feed**, and fill in five parts:

| Part | What to put in it |
|---|---|
| **Source** | The saved query from step 2 |
| **Address** | A slug that reads as a name: `vehicles-live`, not a number. Lowercase letters, digits and hyphens, 64 characters. It cannot be renamed later |
| **Visibility** | Public if riders' software should read it without a credential. Private means the address answers a token and nothing else, which is a different guide: [Distribute a feed to a named partner](/use-cases/feed-to-a-partner) |
| **Shape** | Standard `gtfs-rt`, version 2.0, entity `vehicle_positions`. That is the one entity a community build *publishes*; publishing trip updates and service alerts takes the [enterprise](/editions) pack, while reading them from somebody else's feed does not |
| **Mapping** | Each field of the standard against a column of your query's result, plus the static GTFS reference, which is required |

Then pick an on-failure mode, and read the two names carefully, because at
serving time they behave the opposite way round from how they sound:

- **Block** refuses to publish a bad read. The address keeps serving the last
  artifact that passed, with its original timestamp, for as long as that takes.
  Age alone never stops it.
- **Last known good** does the same and adds a maximum age. Past that age the
  address stops answering at all.

So the tolerant-sounding option is the one that can take your feed dark. Pick
`block` when a consumer coping with stale data is better than a consumer getting
nothing, and `last_good` when serving hours-old positions would be worse than
silence. For vehicle positions, silence is usually the honest answer, and a cap
somewhere near a few multiples of your publish interval is the shape of it.

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
credential, on the grounds that most software speaking this format will never
hold one.

Two things to tell whoever consumes it:

- Everything the endpoint refuses answers the same 404 with the same body. An
  unknown slug, a private feed and a feed that has never published clean are
  indistinguishable from outside.
- Under `last known good`, once the artifact is older than the cap the endpoint
  answers 503 with a `Retry-After` carrying that cap. It is the feed's stated
  staleness tolerance, not a prediction of when the next publish lands.

### 6. Keep it publishing

A community build publishes when an administrator presses the button. An
[enterprise](/editions) build runs a worker beside the API, and the feed's page
carries an **Automatic publishing** panel offering every minute, five, fifteen,
hourly or daily. See [Publishing on a
cadence](/features/published-feeds#publishing-on-a-cadence).

## How you know it worked

Three checks, in increasing order of how much they prove.

First, the header says Serving. One word for whether the bytes at that address
came from an attempt that published.

Second, the publish history has no findings you have not read. A published
attempt still lists what the validator said, under *Warnings the feed published
with*. A feed that published is not a feed with nothing to say about itself, and
dropping those warnings is how a slow drift out of conformance stays invisible
until it becomes an error.

Third, a consumer reads it. The two checks above are about your instance. This
one is about the internet between it and a rider's phone, which is a different
question and the one nobody tests:

```bash
curl -sI https://your-node.example.gov/api/public/feeds/vehicles-live
```

A `200` with `content-type: application/x-protobuf` means the address is
reachable and answering with a feed. A `404` from outside, on a slug you can see
serving inside, is a hosting or proxy problem rather than a publishing one.
Everything the endpoint refuses answers the same 404, so the status line will
not tell you which, and the feed's own page will.

## Your static feed is a dependency

The static GTFS reference in the binding is not a label. The validator fetches
and prepares that archive to check your realtime bytes against, so the archive's
availability sits directly in the publish path:

| What happened to the static feed | What happens to this feed |
|---|---|
| The URL moved, or started 404ing | The prepare fails, the attempt is recorded, and nothing new publishes |
| It is stale, describing last quarter's service | Publishes carry conformance findings about trips and stops that no longer match |
| It got much larger | The first prepare after a change is slow, and a publish attempt can hit it |

The practical rule is that a service change is a two-part event: the schedule
changes, and this feed starts being checked against a different archive on the
next publish. Watch the publish history across a service change instead of
assuming it rode through.

The archive itself can be checked before you bind anything to it. The same
validator service that checks your realtime bytes answers a second route,
`POST /validate-static`, which runs
[`gtfs-validator`](https://github.com/veodyn/gtfs-validator), our own pure-Python
reimplementation of the canonical rule set, over a static archive on its own
merits. It is a call an operator makes against the service rather than a screen
in the product, and [Query a static GTFS
archive](/use-cases/static-gtfs-archive#check-the-archive-before-you-rely-on-it)
covers what it takes and what it hands back.

## What takes it off the air

| What happened | What consumers see |
|---|---|
| No validator configured | Nothing ever publishes. Every attempt is recorded `failed`, and this is intended behaviour, not a misconfiguration to work around |
| You edited a live feed | The feed goes dark until a new attempt succeeds. The button reads **Save and republish** and a confirmation states that consequence |
| The artifact aged past the cap under `last known good` | 503 with `Retry-After` |
| You deleted the feed | 404, indistinguishable from a slug that never existed. There is no undo |
| The bound query stopped running | The last good artifact keeps serving under `block`, indefinitely. [Schedules](/features/schedules) and this feed's own publish history are where that shows; [Captures](/features/captures) shows it too, but only if the bound query's source has historical capture switched on |

One thing that will *not* happen: a mapping mistake reported as a data problem.
Serialization always runs before validation, so a column mapped to the wrong
thing is named as a mapping defect instead of surfacing as a conformance rule
about a trip id that does not exist.
