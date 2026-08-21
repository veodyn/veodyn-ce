---
sidebar_position: 4
title: Query a static GTFS archive
description: "Reading the schedule tables out of a GTFS zip as ordinary query results: the resource list, column projection and filters, the row cap, joining to realtime ids, and checking the archive before anything depends on it."
---

# Query a static GTFS archive

A GTFS archive is a zip of CSV files, and almost every question about service
lives in four of them. This connector serves those files as query results, so
`routes`, `trips`, `stop_times` and `calendar` are things you can join, count and
put on a dashboard beside the realtime feeds, without unpacking anything by hand.

Two other guides depend on it: a [GTFS-Realtime
feed](/use-cases/publish-gtfs-realtime) is validated against an archive, and an
[on-time performance board](/use-cases/on-time-performance) needs the archive to
resolve the names its own feed carries only ids for.

## What has to be true

The archive has to be reachable over HTTP as a zip, at a URL that does not need
a credential. That is the only requirement, and it's usually the URL you already
publish publicly.

Two details about how it is read matter before you write a query:

- The archive is fetched once per query, with no cache, so a ten-line query
  against `routes` costs the same download as a full read of `stop_times`.
  Prefer fewer, wider queries on a schedule over a dashboard of widgets that
  each fetch the same zip.
- A query against this source is a JSON descriptor rather than SQL. To join two
  tables, or to join a table to anything else, read each one and compose the
  results in a `results` data source, the same way the other connectors work.

## Before you start

- The archive URL.
- A rough idea of how large the biggest table you care about is. Usually that's
  `stop_times`: an agency with a few hundred routes can carry several million
  rows in it.

## The steps

### 1. Add the data source

**Admin → Data Sources → New Data Source**, type Static GTFS. Two fields:

| Field | What to set |
|---|---|
| **GTFS archive URL** | The `http(s)://` address of the zip. Required |
| **Max rows per query** | The cap a single table read returns. Default 100,000, and it will not go above 1,000,000 |

Leave the cap alone until a query hits it. Raising it costs memory on every read
of a large table, and a filter usually solves the same problem.

### 2. Ask what is in the archive

The default query enumerates the tables:

```json
{"resource": "list"}
```

You get one row per table, with the table's name, its row count and its column
list. Run it first on any archive you have not read before, because agencies
vary in which optional files they publish and two feeds that both call
themselves GTFS can have different column sets. The row counts also show which
reads will be cheap.

The schema browser shows the query format instead of the archive's tables. The
archive sits behind an HTTP fetch, and populating a sidebar from it would cost
that fetch every time the editor opened, so the browser points at
`{"resource": "list"}` for discovery.

### 3. Read a table, narrowly

The whole of one table:

```json
{"table": "stops"}
```

Only the columns a map needs:

```json
{"table": "stops", "columns": ["stop_id", "stop_name", "stop_lat", "stop_lon"]}
```

If a projection names a column the table does not have, the query fails and the
error lists the columns it does have, so a typo produces an error rather than an
empty result.

Rows matching a value, or one of several:

```json
{"table": "trips", "filter": {"route_id": ["12", "14"]}}
```

Both sides of a filter are compared as text, so `"12"` and `12` behave the same
way and only the characters matter. Leading zeros count: a `route_id` of `012`
in the archive is not matched by `12`. Several keys in one filter AND together.
Filters do equality on a column and nothing else, with no inequality, no range
and no pattern match, so anything more selective has to happen in a `results`
query over what comes back.

Naming a column that is not there fails differently depending on where you name
it. A projection errors, as above. A filter matches nothing, so the query
succeeds and returns an empty table. Check an empty result from a filtered read
against the column list before concluding the archive has no such rows.

### 4. Know how the row cap behaves

The filter is applied first and the cap second, so a filtered query returns up
to `max_rows` matching rows. It does not read the first `max_rows` rows of the
file and then filter those. That ordering is why filtering helps on a large
table.

When a read does hit the cap, you get the first rows that matched, the runner
logs a warning, and the result is flagged as truncated in its payload. Nothing
in the results grid draws that flag. The check is arithmetic: if a table comes
back at exactly the cap, compare it against the row count
`{"resource": "list"}` reported for it, then either narrow the filter or raise
the cap.

The archive itself is bounded too, independently of the row cap. A zip declaring
more than 1,000 members, or expanding past 500 MB in total, is refused with a
message naming the number it broke. A third bound catches a single member that
expands more than 200 to 1. That one applies only to members of at least 1,024
compressed bytes, because below that size a high ratio says nothing: a few
hundred bytes of repeated text compresses just as hard as a bomb does. Small
members are left to the 500 MB total instead. Those bounds are there to stop
hostile archives rather than to limit large ones, and a real agency feed is well
under all three.

### 5. Join the schedule to the realtime feed

A GTFS-Realtime message carries `trip_id`, `route_id` and `stop_id` but almost
nothing a person would recognize, and turning those ids into names is the
archive's most common job.

| You have | Read | For |
|---|---|---|
| `route_id` | `routes` | `route_short_name`, `route_long_name` |
| `stop_id` | `stops` | `stop_name`, and coordinates for a map |
| `trip_id` and no `route_id` | `trips` | The `route_id` that trip belongs to. It carries no names of its own |
| `trip_id` and a stop | `stop_times` | The scheduled arrival and departure at that stop, which is what a delay is measured against |

Check the column types before you write the join. Any column whose name ends in
`_id` comes back as text, whatever its values look like, because a numeric
`route_id` typed as a number would lose a leading zero and stop matching the
realtime feed's string ids. Every other column is typed from the values actually
returned, so `monday` in `calendar` arrives as a number and the comparison is
`c.monday = 1` rather than `c.monday = '1'`.

Dates and times come out differently under that rule. GTFS writes a date as
`20260801`, and the type guess tries whole numbers before anything else, so a
date column arrives as a number. Write `c.start_date >= 20260801` unquoted; it
still sorts correctly because the format is fixed width. A GTFS time is written
`07:15:00` and is allowed to run past `24:00:00`, so it never reads as a number.
The guess that does match a time is a timestamp, and a timestamp guess is turned
back into text before the column is built, because the same guess reads `7th St`
as a date. Times stay strings and compare as strings, which sorts them the way
you want only because GTFS pads them to two digits.

Compose them in a `results` data source, over the cached results of the reads
above:

```sql
SELECT r.route_short_name, count(*) AS vehicles
FROM cached_query_41 v
JOIN cached_query_12 t ON t.trip_id = v.trip_id
JOIN cached_query_13 r ON r.route_id = t.route_id
GROUP BY r.route_short_name
ORDER BY vehicles DESC
```

Schedule the archive reads much less often than the realtime one. A static feed
changes when service changes, so daily is generous, and the realtime query
underneath it can run every minute against results fetched that morning.

### Check the archive before you rely on it {#check-the-archive-before-you-rely-on-it}

All of the above assumes the archive is sound, and the validator service this
deployment already runs for feed publishing has a second route that checks that:

```bash
curl -s -F gtfs=https://transit.example.gov/gtfs/feed.zip \
  http://<validator-host>/validate-static
```

It answers 200 with two objects. `report` is the same summary and notice list
the canonical validator's own CLI writes, and `systemErrors` holds the failures
that happened to the run rather than to the feed. An archive that will not open
at all still answers 200, with the reason in `systemErrors`, because the
underlying package treats never-opened and opened-but-a-table-failed as the same
kind of outcome. A non-200 is about the request or the download: 400 for sending
both an upload and a URL or neither, 502 for a URL that could not be fetched.
You can upload an archive instead of naming one, with `-F archive=@feed.zip`.

There is no screen for this in the product; it is an operator's call against the
service. The service is the one named by `VEODYN_FEED_VALIDATOR_URL`, see
[Configuration](/configuration#sidecar-api), and it is normally reachable only
from inside the deployment.

Run it before a service change goes live. Run it again on the vendor archive
during a [feed migration](/use-cases/take-back-a-vendor-feed), where a bad
archive produces findings on both sides of the comparison and makes the
comparison useless.

## How you know it worked

`{"resource": "list"}` names the tables you expected, with row counts in the
range you expected, and a read of `routes` returns route names you recognize.

Then check one trip end to end: pick a trip out of `trips`, look it up in your
scheduling system, and confirm the stop sequence and times agree. An archive
that parses cleanly can still be describing service that is no longer running.

## What takes it off the air

| What happened | What you see |
|---|---|
| The archive URL moved or started 404ing | The query fails naming the HTTP status. Every query against the source fails, since there is no cache to serve from |
| The zip is served but is not a zip | The query fails saying so, which is the usual symptom of an error page returned with a 200 |
| A table you query stopped being published | Unknown table, with the tables the archive does hold listed beside it |
| A column was renamed upstream | Unknown column, with the available columns listed, if you projected it. If you only filtered on it, an empty table and no error |
| The read hit the row cap | A table that looks complete but is short. Nothing on screen says so, so compare against the list's row count |

## What this does not do

It does not validate on read. A query returns what the file holds, including
whatever is wrong with it, which is why the validator check above is a separate
step.

It does not join, cache or write. Fares, transfers, shapes and the other
optional files are readable if the archive carries them, on the same terms as
the four tables above.
