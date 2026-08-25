---
sidebar_position: 9
title: Report on demand-response service
description: "Paratransit and dial-a-ride performance out of the dispatch system: the four measures worth a board, the trap in each one, and where the denominators have to agree."
---

# Report on demand-response service

Demand-response performance is measured against promises made to individual
riders: a pickup window, a trip that was booked, a ride that does not take
absurdly long. Agencies track denials, missed trips, untimely pickups and trip
length because paratransit service criteria turn on them, and because they are
what riders complain about.

All of those numbers already exist inside your scheduling and dispatch system.
What this page covers is getting them onto one board, computed the same way each
month.

## What has to be true

There is no demand-response connector here. The source is your dispatch system,
reached through a [data source](/admin/data-sources) pointed at your scheduling
vendor's database, or at a replica of it, or at an export you land in your own
warehouse.

Getting read access is usually most of the work. Ask for a read-only replica
rather than credentials on production, and expect the vendor to have a supported
way to provide one. Where they do not, a nightly export landed in a warehouse
table is a workable second best. Put [historical
capture](/use-cases/history-capture) on that warehouse source and the monthly
snapshots accumulate in-product, so the trend survives even if the vendor only
ever hands you a current-state file.

You also need the definitions written down once, since they are yours rather
than the product's. The pickup window is whatever your standards say it is. A
denial is a trip request the system could not accommodate, and vendors record
that in more than one way. A no-show is attributed to the rider, and a missed
trip is attributed to the agency. Those last two get conflated constantly, which
attributes an agency failure to the rider.

## Before you start

- Read access to trips, bookings and cancellations, with timestamps.
- Your service standards' pickup window and trip-length comparison rule.
- The same mode and type-of-service coding used in the [monthly ridership
  pack](/use-cases/ridership-reporting), so the two boards agree.

## The steps

### 1. Get to one trip-level table

Whatever the vendor's schema, reduce it to one row per booked trip with these
columns. Do it in a single query that everything else reads:

| Column | Holds |
|---|---|
| `trip_id`, `service_date` | Identity |
| `requested_pickup`, `promised_pickup`, `actual_pickup` | The three times that matter |
| `actual_dropoff` | For trip length |
| `status` | Completed, cancelled, no-show, missed, denied, in the vendor's own vocabulary |
| `distance_miles` | For the comparison in step 3 |

Those three pickup times are easy to mix up. Performance is actual against
promised, because the promise is what the agency made. Actual against requested
measures something else: how often the requested time was available.

### 2. Compute the four measures

```sql
WITH 0 AS window_early, 1800 AS window_late   -- seconds, from your standards
SELECT
  date_trunc('month', service_date) AS month,
  count(*) FILTER (WHERE status = 'completed')                    AS completed,
  count(*) FILTER (WHERE status = 'denied')                       AS denials,
  count(*) FILTER (WHERE status = 'missed')                       AS missed_trips,
  count(*) FILTER (WHERE status = 'no_show')                      AS no_shows,
  count(*) FILTER (
    WHERE status = 'completed'
      AND extract(epoch FROM actual_pickup - promised_pickup)
          BETWEEN window_early AND window_late
  )                                                               AS on_time
FROM dr_trips
WHERE service_date >= date_trunc('month', now()) - INTERVAL '13 months'
GROUP BY month
ORDER BY month DESC
```

Compute the ratios in the visualization or in a `results` query on top. Keep the
counts and the percentages in the same table, so a reader can see what each
percentage was calculated over.

![A query's read view with its results table](/img/screenshots/query-view.png)

### 3. Add the trip-length comparison

The comparison that matters to a rider is how long the same journey would take
on fixed route, so you need a fixed-route travel time from somewhere.

Your own schedule is already queryable. The [static GTFS
archive](/use-cases/static-gtfs-archive) holds `stop_times`, which carries an
arrival and departure time per stop per trip, and `trips`, which links each trip
to its route. Between an origin stop and a destination stop on the same trip,
the difference of those two times is the scheduled ride. A `results` query
joining the two tables turns that into a lookup you can check an
origin-destination pair against. What you get is the schedule rather than what
actually ran, which is the right comparison here, since the rider's alternative
was the timetable.

That leaves out any trip a rider would have had to make with a transfer, or with
a walk at either end. Nothing above computes a path through the network, so an
O-D pair with no single trip serving it has no scheduled time here. Closing that
gap takes a trip planner or a routing service, which stays an outside
dependency.

If you have none of this, report the distribution of actual ride times by
distance band instead. That is useful operationally. Label it as a ride-time
distribution rather than as a fixed-route comparison.

### 4. Build the board

- Counters for the month: completed trips, denials, missed trips, on-time
  percentage.
- A line chart by month over thirteen months, so this month sits against the
  same month last year.
- A histogram of pickup deviation in minutes. This shows whether late pickups
  are two minutes late or forty, which the on-time percentage on its own does
  not.
- A table of the longest rides in the period, for operations.

### 5. Make the denominators agree

The demand-response UPT in your monthly pack and the completed trips on this
board should either be the same number or differ for a reason you can state.
They often do differ, legitimately: a trip with two passengers is one trip and
two unlinked passenger trips.

Put both numbers on the board with their definitions in the titles.

## How you know it worked

Take one week and walk it with the dispatch supervisor, trip by trip on the
exceptions. Denials and missed trips are where vendor vocabulary and agency
vocabulary diverge, so use the walk-through to agree on what each status means
before the board goes out.

## What this does not do

It does not schedule, dispatch, or contact riders, and it does not decide
eligibility. It reads what the dispatch system recorded and reports it. If a
cancellation was keyed as a no-show, the board reports a no-show, which is what
step 5 and the walk-through above are there to catch.
