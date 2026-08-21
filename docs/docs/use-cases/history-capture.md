---
sidebar_position: 14
title: Build a history you can trend
description: "Connectors answer with now. Historical capture accumulates query results into a warehouse table you can query, which is what every trend, rollup and month-over-month recipe is built on."
---

# Build a history you can trend

A connector answers with the present: the vehicles moving now, the stations as
they stand, the alerts currently open. The guides that follow ask a different
kind of question, about last Tuesday or about the month. That needs the answers
accumulated somewhere, which is what historical capture does.

Read this one first if you are heading for [fleet
utilization](/use-cases/fleet-utilization), [on-time
performance](/use-cases/on-time-performance) or the [incident and air quality
picture](/use-cases/incident-and-air-quality). The rest of the recipes read
warehouses you already keep, and do not need it.

## What has to be true

1. The instance needs a historical warehouse. An operator sets
   `REDASH_HISTORICAL_CLICKHOUSE_URL`. If it is empty, capture is disabled
   globally and no per-source setting turns it back on. See
   [Configuration](/configuration#query-service).
2. The data source needs capture switched on. The option is
   **Historical capture (scheduled runs → warehouse)**, off by default, and
   every source type offers it.
3. The run has to be a kind that capture is armed for. Scheduled runs of a
   saved query are captured as soon as the source opts in. Manual runs are
   captured only if the source also has **Capture manual runs too** switched
   on. A run from the editor against an unsaved query is never captured,
   regardless of either checkbox, because there is no query id to file the rows
   under.

The third condition determines the shape of the accumulated table. Scheduled
runs give a uniform time axis. Manual runs land in the same table and arrive
whenever someone pressed the button, so a chart drawn over both has a time axis
with clumps in it. That is fine while backfilling, or while testing a capture
before settling on a cadence, but it is a poor basis for a month-over-month
rollup.

A manual run of a parameterized query captures whatever parameters it ran with,
into the same table as the scheduled snapshots. Nothing in the table records
which parameters those were beyond the columns the result itself carries. If
you need to tell two runs apart by a parameter, that parameter has to appear in
the result.

:::note A warehouse of your own probably does not want this

Capture is offered on every registered source type, including a PostgreSQL or
ClickHouse database you already run. It is rarely the right answer there: that
database keeps its own history, and querying it directly avoids a second copy
with its own retention policy. Capture is most useful against a source that
only reports current state.

:::

## Before you start

You need a working data source and an idea of the cadence you want. Every
captured run appends a full result set, so cadence and retention together
decide how large the table gets.

## The steps

### 1. Switch capture on for the source

**Admin → Data Sources**, open the source, and set:

| Field | What it does |
|---|---|
| **Historical capture (scheduled runs → warehouse)** | Off by default. When on, every scheduled run of every saved query against this source appends its rows |
| **Capture manual runs too** | Off by default. When on, the same applies to manual runs of saved queries. Runs from the editor against an unsaved query are still never captured |
| **Historical retention (days, 0 = keep forever)** | Becomes a TTL on the table at creation. `0` keeps everything |

Decide retention before the first capture. The value is applied when the table
is created, so changing your mind later means altering a table that already
exists.

### 2. Give the query a schedule and a name you can live with

Attach a [refresh schedule](/features/queries#the-query-actions-menu). Cadence
drives the row count: a one-minute schedule on a fifty-row connector read is
72,000 rows a day, and an hourly one is 1,200.

The table name is derived from the query's name once, at first capture, and
then persisted, so later renames never orphan the history. Give the query a
sensible name before it captures for the first time.

### 3. Query the accumulated table

The warehouse is a data source of its own. Its tables sit in the `historical`
database, named `q_<slug>_<query id>`, and each one carries two columns added
by the capture:

| Column | Type | What it holds |
|---|---|---|
| `captured_at` | `DateTime64(3, 'UTC')` | When this run's rows were appended. Use it as the time axis |
| `query_id` | `UInt32` | Which query produced them |

After those come your own result columns, under names derived from theirs.
Tables are `MergeTree`, partitioned by month on `captured_at` and ordered by
it, so a time-bounded query is cheap and an unbounded one reads everything.

Column names here are not always the alias you wrote upstream, so read the
derivation before writing SQL against the table. Each name is lowercased, and
every run of characters outside letters, digits and underscores becomes a
single underscore, so `Avg Bikes` lands as `avg_bikes` and `bikes (avail.)` as
`bikes_avail`. A name starting with a digit picks up a leading underscore,
because `7day_avg` is not a legal identifier. A result column of your own
called `captured_at` or `query_id` is renamed with a `_field` suffix, since the
capture uses those two names. If two columns come out of all that identical, a
numeric suffix separates them, so the second `avg_bikes` becomes `avg_bikes_2`.

The usual symptom is a missing-column error: a query that ran fine against the
connector fails against the warehouse copy of its own results, because the
alias pasted across is not what the column is called there. Read the names off
the dataset's schema in the catalog rather than off the query that produced
them.

Queries against a snapshot table usually take one of two shapes. The state at a
past moment:

```sql
SELECT *
FROM historical.q_bikeshare_stations_42
WHERE captured_at BETWEEN '2026-08-01 00:00:00' AND '2026-08-01 23:59:59'
  AND station_id = '1042'
ORDER BY captured_at
```

Or a rollup, which is what most dashboards need:

```sql
SELECT toStartOfHour(captured_at) AS hour,
       station_id,
       avg(num_bikes_available) AS avg_bikes,
       min(num_bikes_available) AS min_bikes
FROM historical.q_bikeshare_stations_42
WHERE captured_at >= now() - INTERVAL 7 DAY
GROUP BY hour, station_id
ORDER BY hour
```

### 4. Find it in the catalog

A captured table appears in the [data catalog](/features/data-catalog) as a
dataset, with its schema, its coverage (first and last timestamp it holds), its
row count, and a freshness badge resolved by the same rule the
[Captures](/features/captures) board uses. Tag the query with `domain:<key>` and
the dataset joins that domain's page.

Check coverage when a trend looks wrong. A chart that starts partway through a
month usually means capture was only switched on then.

## How you know it worked

Wait for one run of the kind you armed, then count rows:

```sql
SELECT count() AS rows, min(captured_at) AS first, max(captured_at) AS last
FROM historical.q_bikeshare_stations_42
```

If it returns nothing, work back through the three conditions above in order.
The two common causes are a query with no schedule on a source that only
captures scheduled runs, and a query that was never saved, which no setting
will capture.

## What takes it off the air

Capture failures are logged and counted, and never affect the query that
triggered them. That keeps the user-facing path safe, but it also means a
broken warehouse is invisible from the interface: the query still runs green
and the dashboard is still current while no rows are landing. The coverage end
date in the catalog is where the gap shows up.

Schema changes upstream do not fail the capture. A result carrying a new column
adds that column to the table. A column whose type conflicts with what is
already stored is widened into a separate `_str` column instead of failing the
insert, so a column that changes type upstream shows up as a second column with
a suffix. Both columns hold real data. Fixing it means correcting the type
upstream.

Once a TTL is set, rows past it are deleted permanently, and a report built on
them cannot be reproduced afterwards. Anything that has to survive (a filed
report's supporting numbers, for instance) should be written out at the time
rather than left in a table with a TTL on it.
