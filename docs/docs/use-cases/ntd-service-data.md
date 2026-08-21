---
sidebar_position: 7
title: Derive NTD service data from your GTFS archive
description: "Reading the scheduled half of a service report off the archive you already publish: which tables answer which question, checking the archive first, and the line where this stops."
---

# Derive NTD service data from your GTFS archive

An NTD submission has two halves. One is counted: passengers, miles, hours,
peak vehicles, and it comes from your APC, farebox and CAD systems. That half is
[the monthly ridership pack](/use-cases/ridership-reporting). The other half
describes the service you scheduled, and for most agencies the schedule of record
is already published as a GTFS archive.

This reads the second half off that archive, so the numbers you report about your
own service and the numbers a rider's app shows come from one file rather than
from a spreadsheet somebody maintains beside it.

:::caution This files nothing, and it is not a compliance product

There is no NTD submission here: no upload, no transmission, no form. What
follows produces figures and the evidence behind them, and a person still enters
them where they are entered.

Nor does it tell you what your reporter type owes. Requirements differ by
reporter type and change between report years, and the current [NTD reporting
policy manual](https://www.transit.dot.gov/ntd) is the only authority on which
figures are asked for and how each is defined. Read it first, then come back and
work out which of these tables answers it.

:::

## What has to be true

The archive has to be the schedule of record, not a derivative of it. Plenty
of agencies build their GTFS by exporting from a scheduling system and then
hand-editing something before publishing. If yours does, the published archive
and the schedule you actually operate have drifted by however much that edit was,
and every figure below inherits the drift. That is worth settling before anyone
reports off it, and the answer is usually to fix the export.

The archive covers the period you are reporting on. An archive is a snapshot
of current service. Last quarter's service is in last quarter's archive, which
you may or may not have kept. If you do not keep dated copies of what you publish,
start: nothing in this product recovers an archive you have thrown away.

The definitions have to be yours. GTFS describes trips and service days.
Whether a particular trip counts as revenue service, and whether a school-day
tripper is a separate pattern or the same route, are agency decisions the file
cannot make for you.

## Before you start

- The archive, queryable as a [Static GTFS data
  source](/use-cases/static-gtfs-archive).
- The current manual for your reporter type, open beside you.
- Your route and mode coding, as the agency files it.

## The steps

### 1. Check the archive before you report off it

Anything derived from a broken archive is a broken figure that looks fine. The
validator service answers a route that checks a static archive on its own merits,
and running it takes one call:

```bash
curl -s -F gtfs=https://transit.example.gov/gtfs/feed.zip \
  http://<validator-host>/validate-static
```

See [Check the archive before you rely on
it](/use-cases/static-gtfs-archive#check-the-archive-before-you-rely-on-it) for
what comes back and how to read it. Do this on the dated archive for the period
you are reporting on, not on whatever is at the URL today.

### 2. Find out which tables this archive actually has

```json
{"resource": "list"}
```

The row counts here are the first sanity check on the whole exercise. An archive
whose `trips` count is a third of what you would guess is telling you something
before you have written a single query.

Watch the calendar files in particular. GTFS lets an agency describe service days
in `calendar`, in `calendar_dates`, or in both, and some feeds carry only
`calendar_dates` with one row per operating day. Which of those you are looking at
decides how the service-day question in step 4 has to be asked.

### 3. Read the tables that answer service questions

| Question | Table | What to read |
|---|---|---|
| How many routes are operated | `routes` | One row per route. `route_type` is the mode as GTFS codes it, which is not your NTD mode coding |
| How many trips are scheduled | `trips` | One row per trip. Each names its `route_id` and its `service_id` |
| What a trip's span and stop count are | `stop_times` | One row per stop per trip, with scheduled arrival and departure |
| Which days a pattern operates | `calendar`, `calendar_dates` | The weekly pattern and its date range, plus the exceptions |

Each is a read against the archive:

```json
{"table": "trips", "columns": ["trip_id", "route_id", "service_id", "direction_id"]}
```

Project the columns you need rather than reading whole tables. `stop_times` is
where the row cap bites, and a projection plus a filter is the difference between
a query that answers and one that comes back quietly short.

### 4. Compose the counts in a results query

The archive reads are the inputs. The arithmetic is SQL over their cached
results:

```sql
SELECT r.route_id,
       r.route_short_name,
       count(DISTINCT t.trip_id) AS trips_on_this_pattern
FROM cached_query_13 r
JOIN cached_query_12 t ON t.route_id = r.route_id
JOIN cached_query_14 c ON c.service_id = t.service_id
WHERE c.monday = 1
GROUP BY r.route_id, r.route_short_name
ORDER BY trips_on_this_pattern DESC
```

Two things that query is quietly assuming, and both have bitten someone:

- The comparison is `c.monday = 1`, unquoted. The connector types each column
  from its values, so a flag column of zeroes and ones arrives as a number, while
  anything named `*_id` is always text so it keeps its leading zeroes and still
  joins. See [Query a static GTFS
  archive](/use-cases/static-gtfs-archive).
- One weekday is not the week. A pattern flagged for Monday may be superseded on
  a specific Monday by `calendar_dates`, and an agency running reduced service on
  a holiday shows that only there. Any figure for a period rather than for a
  typical day has to read the exceptions.

### 5. Put the definitions next to the numbers

Every figure here rests on a decision the file did not make: which routes counted,
whether a deviated trip is its own route, how a holiday was handled. Write each
one into the query's description, the same discipline the [ridership
pack](/use-cases/ridership-reporting) uses, and the answer to "where did 214 come
from" is a link rather than a conversation.

## How you know it worked

Reproduce a period you have already filed. Run the queries against that period's
archive and compare to what you submitted, line by line. A difference is not a
failure, it is a definition surfacing, and each one is worth a written cause:
a route coded differently, a school tripper counted one way in the spreadsheet and
another way here, an archive published a week after service changed.

One reconciliation at the start catches more than any amount of checking later.

## What takes it off the air

| What happened | What you see |
|---|---|
| The published archive drifted from the operated schedule | Figures that are internally consistent and wrong. Nothing here can detect it; only comparing against the scheduling system can |
| You did not keep the period's archive | The reads run against current service and answer a different question than the one you asked |
| The feed describes service days only in `calendar_dates` | A query joining `calendar` returns nothing, or a small unrepresentative slice |
| A `stop_times` read hit the row cap | A trip-span figure computed over part of the file. Compare against the row count from step 2 |

## What this does not do

It does not count passengers, miles or hours. Those come from systems that
measure, and they are covered in [the ridership
pack](/use-cases/ridership-reporting), including the caution that FTA approval of
automatic passenger counters is a matter for the equipment and its validation
programs rather than for how the numbers are later assembled.

It does not know your reporter type, your mode coding, or what this year's manual
asks for. It reads the schedule you published, accurately, and leaves every
question of what is required to the manual and to you.
