---
sidebar_position: 8
title: Report on demand-response service
description: "Paratransit and dial-a-ride performance out of the dispatch system: the four measures worth a board, the trap in each one, and where the denominators have to agree."
---

# Report on demand-response service

Demand-response performance is measured against promises made to individual
riders: a pickup window, a trip that was booked, a ride that does not take
absurdly long. Agencies track denials, missed trips, untimely pickups and trip
length because paratransit service criteria turn on them, and because they are
what riders complain about.

Every one of those numbers already exists inside your scheduling and dispatch
system. This gets them onto one board, computed the same way each month.

## What has to be true

The dispatch system is the source. There is no demand-response connector
here. What this uses is a [data source](/admin/data-sources) pointed at your
scheduling vendor's database, or at a replica of it, or at an export you land in
your own warehouse.

Getting read access is usually the whole project. Ask for a read-only replica
rather than credentials on production, and expect the vendor to have a supported
way to provide one. Where they do not, a nightly export landed in a warehouse
table is a workable second best: put [historical
capture](/use-cases/history-capture) on that warehouse source and the monthly
snapshots accumulate in-product, so the trend survives even if the vendor only
ever hands you a current-state file.

The definitions are yours, and they have to be written down once. A pickup
window, whatever your standards say it is. A denial, which is a trip request the
system could not accommodate, and which vendors record in more than one way. A
no-show, which is the rider's, against a missed trip, which is yours. Those last
two get conflated constantly, and conflating them moves a number from your
column to the rider's.

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
| `requested_pickup`, `promised_pickup`, `actual_pickup` | The three times that matter, and they are three, not two |
| `actual_dropoff` | For trip length |
| `status` | Completed, cancelled, no-show, missed, denied, in the vendor's own vocabulary |
| `distance_miles` | For the comparison in step 3 |

The three pickup times are the part people get wrong. Performance is actual
against promised, since the promise is what the agency made. Actual against
requested measures how often the requested time was available, which is a real
measure of a different thing.

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

Then the ratios, in the visualization or in a `results` query on top. Keep the
counts and the percentages in the same table: a percentage without its
denominator is the fastest way to a board nobody can reconcile.

### 3. Add the trip-length comparison

The comparison that matters to a rider is against how long the same journey
would take on fixed route, and that needs a fixed-route travel time from
somewhere.

Your own schedule is one such somewhere, and it is already queryable. The
[static GTFS archive](/use-cases/static-gtfs-archive) holds `stop_times`, which
carries an arrival and departure time per stop per trip, and `trips`, which
links each trip to its route. Between an origin stop and a destination stop on
the same trip, the difference of those two times is the scheduled ride, and a
`results` query joining the two tables turns that into a lookup an
origin-destination pair can be checked against. It is the schedule rather than
what actually ran, which is the right comparison here: the rider's alternative
was the timetable, not a particular bus's bad afternoon.

The remaining gap is the trip a rider would have had to make with a transfer, or
with a walk at either end. Nothing above computes a path through the network, so
an O-D pair with no single trip serving it has no scheduled time here. A trip
planner or a routing service is what closes that, and it stays an outside
dependency.

If you have none of this, report the distribution of actual ride times by
distance band instead, and say that is what it is. That is honest and useful
operationally. It is not the comparison, though, so do not label it as one.

### 4. Build the board

- Counters for the month: completed trips, denials, missed trips, on-time
  percentage.
- A line chart by month over thirteen months, so this month sits against the
  same month last year.
- A histogram of pickup deviation in minutes. It is worth more than the on-time
  percentage on its own, because it shows whether late pickups are two minutes
  late or forty.
- A table of the longest rides in the period, which is the one operations reads.

### 5. Make the denominators agree

The demand-response UPT in your monthly pack and the completed trips on this
board should be the same number, or you should know exactly why they differ.
They often do differ, legitimately: a trip with two passengers is one trip and
two unlinked passenger trips.

Put both numbers on the board with their definitions in the titles. An unexplained
gap between two of your own numbers is what turns an otherwise fine report into
an argument.

## How you know it worked

Take one week and walk it with the dispatch supervisor, trip by trip on the
exceptions. Denials and missed trips are where vendor vocabulary and agency
vocabulary diverge, and one hour of that conversation settles definitions that
would otherwise be re-litigated every month.

## What this does not do

It does not schedule, dispatch, or contact riders, and it does not decide
eligibility. It reads what the dispatch system recorded and reports it. If the
recording is wrong, because a cancellation was keyed as a no-show, this board
will report that faithfully and confidently, which is exactly why step 5 and the
walk-through above are in here.
