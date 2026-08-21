---
title: "On-time performance"
description: "Turning an agency's own GTFS-Realtime trip updates into an on-time performance percentage by route and day, using only the query service and the data catalog."
sidebar_position: 1
---

# On-time performance

## What you get

OTP% per route and day, computed from the delays the agency's own AVL system
publishes in its GTFS-Realtime trip-update feed.

## Step 1: configure the GTFS-Realtime data source

Add or edit a [data source](/admin/data-sources) of type `gtfs_realtime` and
set its **Trip updates URL** to the agency's trip-updates feed: the HTTP
protobuf endpoint agencies publish separately from vehicle positions and
service alerts (see [Connectors](/connectors)). The existing Feed URL keeps
serving vehicle positions; you are only adding the trip-updates URL beside it.

## Step 2: query trip updates and capture it

Create a query against that data source with `{"resource": "trip_updates"}`
as its body. Put the query on a [schedule](/features/schedules) so it runs on
its own, then enable [historical capture](/features/captures) on the data
source so each scheduled run accumulates rows in the warehouse instead of only
holding the latest result.

## Step 3: find the dataset and query the warehouse table

After the first successful scheduled capture, the captured rows show up as a
dataset in the [data catalog](/features/data-catalog). The dataset's id is the
warehouse table name; copy it from the `<id>` part of the dataset page's URL.

**Query this dataset** on that page opens the capture query itself, the
`{"resource": "trip_updates"}` query against the GTFS-Realtime connector,
since that is the dataset's sample query. The SQL below runs against the
warehouse instead, so open a new query against the warehouse's own data
source (or a blank editor) and point it at that table name. OTP% is the
average of `on_time` grouped by route and day:

```sql
SELECT
    route_id,
    toDate(timestamp) AS day,
    avg(on_time) * 100 AS otp_pct
FROM q_trip_updates_capture
GROUP BY route_id, day
ORDER BY day, route_id
```

`on_time` is `NULL` for a skipped stop, a canceled trip, or a stop_time_update
the feed carries no delay for. ClickHouse's `avg()` drops `NULL` values rather
than counting them, so those rows fall out of the percentage by design instead
of counting as late.

## Step 4: put it on a dashboard

Add the query as a widget on a [dashboard](/features/dashboards). If you want
names alongside the ids, join the Static GTFS connector's `stops` table for
`stop_name` and its `routes` table for `route_short_name` (see
[Connectors](/connectors)); those come from the agency's static feed, not
from `trip_updates` itself. `trips` links `trip_id` to `route_id` when a
join needs that step in between; it carries no name columns of its own.

## Honest limits

OTP computed this way reflects the delays the agency's own feed reports at
each stop, nothing more. It is only as accurate as the AVL system generating
that feed: a feed that publishes sparse or unreliable delay data produces a
sparse or unreliable OTP%. And a feed that carries no trip updates at all,
only vehicle positions, cannot produce OTP: there is nothing here to compute
against.
