---
sidebar_position: 14
title: Build a history you can trend
description: "Connectors answer with now. Historical capture accumulates query results into a warehouse table you can query, which is what every trend, rollup and month-over-month recipe is built on."
---

# Build a history you can trend

A connector answers with the present: the vehicles moving now, the stations as
they stand, the alerts currently open. Every analysis in the guides after this
one asks a different kind of question, about last Tuesday, or about the month.
That needs accumulation, and this is the mechanism for it.

Read this one first if you are heading for [fleet
utilization](/use-cases/fleet-utilization), [on-time
performance](/use-cases/on-time-performance) or the [incident and air quality
picture](/use-cases/incident-and-air-quality). The rest of the recipes read
warehouses you already keep, and do not need it.

## What has to be true

Three conditions, and the third has two answers rather than one.

1. The instance has a historical warehouse. An operator sets
   `REDASH_HISTORICAL_CLICKHOUSE_URL`. Empty disables capture globally, with no
   per-source setting able to turn it back on. See
   [Configuration](/configuration#query-service).
2. The data source has capture switched on. It is a per-source option,
   **Historical capture (scheduled runs → warehouse)**, off by default, and it
   is offered on every source type.
3. The run has to be one that capture is armed for. A scheduled run of a saved
   query is captured as soon as the source opts in. A manual run is captured
   only if the source also has **Capture manual runs too** switched on. A run
   from the editor against an unsaved query is never captured, whatever either
   checkbox says, because there is no query id to file the rows under.

That third condition is where the accumulated table's shape is actually decided.
Scheduled runs give a uniform time axis, which is what a trend wants. Manual runs
land in the same table and arrive whenever somebody pressed the button, so a
chart drawn over both has a time axis with clumps in it. That is fine for
backfilling or for testing a capture before you commit to a cadence, and it is
not what you want under a month-over-month rollup.

A manual run of a parameterized query captures whatever parameters it ran with,
into the same table as the scheduled snapshots. Nothing in the table records
which parameters those were beyond the columns the result itself carries, so a
parameter worth telling two runs apart by belongs in the result.

:::note A warehouse of your own probably does not want this

Capture is offered on every registered source type, including a PostgreSQL or
ClickHouse database you already run. It is rarely the right answer there: that
database keeps its own history, and querying it directly avoids a second copy
with its own retention policy. The place capture earns its keep is a source that
only ever answers with now.

:::

## Before you start

A data source that works, and an idea of the cadence you want. Every captured
run appends a full result set, so cadence and retention together decide how large
this gets.

## The steps

### 1. Switch capture on for the source

**Admin → Data Sources**, open the source, and set:

| Field | What it does |
|---|---|
| **Historical capture (scheduled runs → warehouse)** | Off by default. On means every scheduled run of every saved query against this source appends its rows |
| **Capture manual runs too** | Off by default. On extends the same behaviour to manual runs of saved queries. Runs from the editor against an unsaved query are still never captured |
| **Historical retention (days, 0 = keep forever)** | Becomes a TTL on the table at creation. `0` keeps everything |

Set retention deliberately at the start. It is applied when the table is
created, so deciding later is a change to a table that already exists rather
than a checkbox.

### 2. Give the query a schedule and a name you can live with

Attach a [refresh schedule](/features/queries#the-query-actions-menu). Cadence
is the whole design decision here: a one-minute schedule on a fifty-row
connector read is 72,000 rows a day, and an hourly one is 1,200.

The table name is derived from the query's name once, at first capture, and
persisted, so later renames never orphan the history. Name the query properly
before its first capture and the table will read well forever.

### 3. Query the accumulated table

The warehouse is a data source of its own. Its tables sit in the `historical`
database, named `q_<slug>_<query id>`, and every one carries two columns the
capture adds:

| Column | Type | What it holds |
|---|---|---|
| `captured_at` | `DateTime64(3, 'UTC')` | When this run's rows were appended. This is your time axis |
| `query_id` | `UInt32` | Which query produced them |

Then your own result columns, under names derived from theirs. Tables are
`MergeTree`, partitioned by month on `captured_at` and ordered by it, so a
time-bounded query is cheap and an unbounded one reads everything.

The derivation is worth reading before you write any SQL against the table,
because a column name here is not always the alias you wrote upstream. Each one
is lowercased, and every run of characters outside letters, digits and
underscores becomes a single underscore, so `Avg Bikes` lands as `avg_bikes` and
`bikes (avail.)` as `bikes_avail`. A name starting with a digit picks up a
leading underscore, since `7day_avg` is not a legal identifier. A result column
of your own actually called `captured_at` or `query_id` is renamed with a
`_field` suffix, those two names being the capture's. And two columns that come
out of all that identical are separated with a numeric suffix, so the second
`avg_bikes` becomes `avg_bikes_2`.

The practical consequence is a missing-column error at the moment you least
expect one: a query that ran fine against the connector fails against the
warehouse copy of its own results, because the alias you pasted across is not
what the column is called there. Read the names off the dataset's schema in the
catalog rather than off the query that produced them.

A snapshot table wants one of two shapes almost every time. The state at a past
moment:

```sql
SELECT *
FROM historical.q_bikeshare_stations_42
WHERE captured_at BETWEEN '2026-08-01 00:00:00' AND '2026-08-01 23:59:59'
  AND station_id = '1042'
ORDER BY captured_at
```

Or a rollup, which is what a dashboard actually wants:

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

Coverage is the number to check when a trend looks wrong. A chart that starts in
the middle of the month usually means capture was switched on in the middle of
the month.

## How you know it worked

Wait for one run of the kind you armed, then count rows:

```sql
SELECT count() AS rows, min(captured_at) AS first, max(captured_at) AS last
FROM historical.q_bikeshare_stations_42
```

If it returns nothing, work back through the three conditions above in order.
The two answers that come up most are a query with no schedule on a source that
only captures scheduled runs, and a query that was never saved, which no setting
will capture.

## What takes it off the air

Capture is fire and forget. A capture failure is logged and counted, and is
never allowed to affect the query that triggered it. That is the right
trade-off for the user-facing path, and it means a broken warehouse looks like
nothing at all from the interface: the query is green, the dashboard is current,
and no rows are landing. The catalog's coverage end is where you would see it.

Schema drift is handled, but visibly. A result carrying a new column adds
that column to the table. A column whose type conflicts with what is already
stored is widened into a separate `_str` column instead of failing the insert,
so a column that quietly changes type upstream shows up as a second column with
a suffix. If you find one, the fix is upstream, and the two columns both hold
real data.

Retention deletes. With a TTL set, rows past it are gone, and no report
built on them can be reproduced afterwards. Anything that has to survive
(a filed report's supporting numbers, for instance) should be written out at the
time rather than left in a table with a TTL on it.
