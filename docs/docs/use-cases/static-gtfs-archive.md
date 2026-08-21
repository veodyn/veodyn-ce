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

It is also the dependency underneath two other guides. A [GTFS-Realtime
feed](/use-cases/publish-gtfs-realtime) is validated against an archive, and an
[on-time performance board](/use-cases/on-time-performance) needs the archive for
the names its own feed carries only ids for.

## What has to be true

The archive is reachable over HTTP as a zip, at a URL that does not need a
credential. That is the whole requirement, and it is usually the URL you already
publish for everyone else.

Two things about how it is read are worth knowing before you write a query:

- The archive is fetched once per query, with no cache. A ten-line query against
  `routes` costs the same download as a full read of `stop_times`. That argues
  for fewer, wider queries and a schedule, not a dashboard full of widgets each
  fetching the same zip.
- Nothing here is SQL. A query against this source is a JSON descriptor. To
  join two tables, or to join a table to anything else, you read each one and
  compose the results in a `results` data source, which is the same seam every
  other connector uses.

## Before you start

- The archive URL.
- A rough idea of how large the biggest table you care about is. `stop_times` is
  usually the one that matters: an agency with a few hundred routes can carry
  several million rows in it.

## The steps

### 1. Add the data source

**Admin → Data Sources → New Data Source**, type Static GTFS. Two fields:

| Field | What to set |
|---|---|
| **GTFS archive URL** | The `http(s)://` address of the zip. Required |
| **Max rows per query** | The cap a single table read returns. Default 100,000, and it will not go above 1,000,000 |

Leave the cap alone until a query hits it. Raising it costs memory on every read
of a large table, and the better answer is nearly always a filter.

### 2. Ask what is in the archive

The default query enumerates the tables:

```json
{"resource": "list"}
```

One row per table, with the table's name, its row count and its column list. Run
this first on an archive you have not read before. Agencies vary in which
optional files they publish, column sets differ between feeds that both call
themselves GTFS, and the row counts tell you which reads are going to be cheap.

The schema browser shows the query format rather than the archive's tables, since
the archive sits behind an HTTP fetch and downloading it to populate a sidebar
would cost that fetch every time the editor opened. `{"resource": "list"}` is the
discovery step it points you at.

### 3. Read a table, narrowly

The whole of one table:

```json
{"table": "stops"}
```

Only the columns you need, which is what a map wants:

```json
{"table": "stops", "columns": ["stop_id", "stop_name", "stop_lat", "stop_lon"]}
```

A projection naming a column the table does not have fails the query and lists
the columns it does have, so a typo comes back as an answer instead of an empty
result.

Rows matching a value, or one of several:

```json
{"table": "trips", "filter": {"route_id": ["12", "14"]}}
```

Both sides of a filter are compared as text, so `"12"` and `12` behave the same
and only the characters matter. A leading zero does, which is the case that
catches people: a `route_id` of `012` in the archive is not matched by `12`.
Several keys in one filter AND together. There is no inequality, no range and no
pattern match: this is equality on a column, and anything more selective belongs
in a `results` query over what comes back.

The two ways of naming a column that is not there fail differently, and the
quieter one is the filter. A projection naming a missing column errors, as
above. A filter naming a missing column matches nothing, so the query succeeds
and returns an empty table. An empty result from a filtered read is worth
checking against the column list before you conclude the archive has no such
rows.

### 4. Know how the row cap behaves

The filter is applied first and the cap second, so a filtered query returns up to
`max_rows` matching rows rather than the first `max_rows` rows of the file with a
filter applied afterwards. That ordering is what makes filtering the real lever
on a large table.

When a read does hit the cap, the rows you get are the first ones that matched,
the runner logs a warning, and the result is flagged as truncated in its payload.
Nothing in the results grid draws that flag, so the practical check is arithmetic:
a table that comes back at exactly the cap is a table to be suspicious of. Compare
against the row count `{"resource": "list"}` reported for it, narrow the filter,
or raise the cap deliberately.

The archive itself is bounded too, independently of the row cap. A zip declaring
more than 1,000 members, or expanding past 500 MB in total, is refused with a
message naming the number it broke. A third bound catches a single member that
expands more than 200 to 1, and it is applied only to members of at least 1,024
compressed bytes: below that size a high ratio says nothing, since a few hundred
bytes of repeated text compresses just as hard as a bomb does, so small members
are left to the 500 MB total. Those bounds exist for archives that are hostile
rather than large; a real agency feed is nowhere near any of them.

### 5. Join the schedule to the realtime feed

This is what the archive is usually for. A GTFS-Realtime message carries ids and
almost no names: `trip_id`, `route_id`, `stop_id` and nothing a person would
recognize. The schedule is where those become readable.

| You have | Read | For |
|---|---|---|
| `route_id` | `routes` | `route_short_name`, `route_long_name` |
| `stop_id` | `stops` | `stop_name`, and coordinates for a map |
| `trip_id` and no `route_id` | `trips` | The `route_id` that trip belongs to. It carries no names of its own |
| `trip_id` and a stop | `stop_times` | The scheduled arrival and departure at that stop, which is what a delay is measured against |

Column types are worth knowing before you write the join. Any column whose name
ends in `_id` comes back as text, always, whatever its values look like: a
numeric `route_id` typed as a number would lose a leading zero and stop matching
the realtime feed's string ids. Every other column is typed from the values
actually returned, so `monday` in `calendar` arrives as a number and
`c.monday = 1` is the comparison, not `c.monday = '1'`.

Dates and times part company under that rule, and the split is the one that
catches people. GTFS writes a date as `20260801`, and the type guess tries whole
numbers before anything else, so a date column arrives as a number: write
`c.start_date >= 20260801` unquoted, and it still sorts correctly because the
format is fixed width. A GTFS time is written `07:15:00` and is allowed to run
past `24:00:00`, so it never reads as a number. The guess that does match a
time is a timestamp, and a timestamp guess is turned back into text before the
column is built, on the grounds that the same guess reads `7th St` as a date.
Times therefore stay strings and compare as strings, which orders them the way
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

Schedule the archive reads far more slowly than the realtime one. A static feed
changes when service changes, so daily is generous, and the realtime query
underneath it can run every minute against results that were fetched this
morning.

### Check the archive before you rely on it {#check-the-archive-before-you-rely-on-it}

Everything above assumes the archive is sound. The validator service this
deployment already runs for feed publishing answers a second route that checks
exactly that:

```bash
curl -s -F gtfs=https://transit.example.gov/gtfs/feed.zip \
  http://<validator-host>/validate-static
```

It answers 200 with two objects: `report`, the same summary and notice list the
canonical validator's own CLI writes, and `systemErrors`, the failures that
happened to the run rather than to the feed. An archive that will not open at all
still answers 200, with the reason in `systemErrors`, since the underlying package
treats never-opened and opened-but-a-table-failed as the same kind of outcome. A
non-200 is about the request or the download: 400 for sending both an upload and a
URL or neither, 502 for a URL that could not be fetched. An archive can be
uploaded instead of named, with `-F archive=@feed.zip`.

This is an operator's call against the service, not a screen in the product. The
service is the one named by `VEODYN_FEED_VALIDATOR_URL`, see
[Configuration](/configuration#sidecar-api), and it is normally reachable only
from inside the deployment.

Run it before a service change goes live, and again on the vendor archive in a
[feed migration](/use-cases/take-back-a-vendor-feed), where a bad archive
otherwise puts findings on both sides of a comparison and tells you nothing.

## How you know it worked

`{"resource": "list"}` names the tables you expected, with row counts in the
range you expected, and a read of `routes` returns route names you recognize.

Then the check that actually settles it: pick one trip out of `trips`, look it up
in your scheduling system, and confirm the stop sequence and times agree. An
archive that parses is not the same as an archive that describes this week's
service.

## What takes it off the air

| What happened | What you see |
|---|---|
| The archive URL moved or started 404ing | The query fails naming the HTTP status. Every query against the source fails, since there is no cache to serve from |
| The zip is served but is not a zip | The query fails saying so, which is the usual symptom of an error page returned with a 200 |
| A table you query stopped being published | Unknown table, with the tables the archive does hold listed beside it |
| A column was renamed upstream | Unknown column, with the available columns listed, if you projected it. If you only filtered on it, an empty table and no error |
| The read hit the row cap | A full-looking table that is quietly short. Nothing on screen says so, so compare against the list's row count |

## What this does not do

It does not validate on read. A query returns what the file holds, including
whatever is wrong with it, which is why the check above is a separate step rather
than something the connector does for you.

It does not join for you, it does not cache, and it does not write. Fares,
transfers, shapes and every other optional file are readable if the archive
carries them, on exactly the same terms as the four this page keeps naming.
