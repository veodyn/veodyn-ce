---
sidebar_position: 16
title: Track fleet utilization from telematics
description: "What the Geotab connector actually returns, the utilization measures you can build from it, and the maintenance questions it cannot answer."
---

# Track fleet utilization from telematics

Telematics answers where the fleet is and whether it is moving. That supports a
narrow, useful set of questions: how many vehicles were in service at 7am, which
ones did not move all week, how utilization looks against the pull-out plan.

It does not support maintenance analytics, and the gap between those two things
is the first thing to be clear about.

## What has to be true

The [Geotab connector](/connectors) exposes two resources:

| Resource | Returns |
|---|---|
| `device_status_info` | `device` (a JSON object with an id), `latitude`, `longitude`, `bearing`, `speed`, `isDriving`, `dateTime` |
| `devices` | Device objects with id, name, serial number, VIN and the rest of the inventory |

That is the surface. There is no engine fault, no odometer, no fuel, no diagnostic
code, and no maintenance record in it. If your question is about failures or
service intervals, it belongs to your maintenance system or to Geotab's own
tooling, and no query here will reach it.

What `device_status_info` gives you is a snapshot: the fleet as it stands right
now. Every utilization measure below is built on
[captured](/use-cases/history-capture) snapshots, and its resolution is the
interval between them. Capture them on a schedule, because a uniform time axis is
what the arithmetic in step 3 assumes. Manual runs can be captured too, and they
land in the same table at whatever moments somebody pressed the button, which
turns "vehicles in service at 7am" into an average over an uneven sample.

## Before you start

- Geotab server, database, username and password. The password is stored
  encrypted.
- A decision about cadence. Five-minute snapshots over a 200 vehicle fleet
  produce 57,600 rows a day; hourly ones produce 4,800. Utilization by hour does
  not need five-minute resolution.

## The steps

### 1. Add the source and switch on capture

**Admin → Data Sources**, type Geotab. Then set **Historical capture (scheduled
runs → warehouse)** on the same form, and a retention that matches how far back
anyone will actually look. That checkbox is on every source type rather than
being anything to do with Geotab; what makes it the right call here is that the
connector answers only with now.

### 2. Two queries, scheduled

The status snapshot, on your chosen cadence:

```json
{ "resource": "device_status_info", "params": { "results_limit": 500 } }
```

And the inventory, daily, because it changes when a vehicle is added:

```json
{ "resource": "devices", "params": { "results_limit": 500 } }
```

`device` arrives as a JSON object rather than a bare id, so extract it once in a
`results` query and join the two together there. Doing it once, in a query
everything else reads, keeps the JSON handling out of every downstream board.

### 3. Compute utilization from the snapshots

Vehicles in service by hour, over the last week:

```sql
SELECT toStartOfHour(captured_at)          AS hour,
       countIf(isDriving)                  AS driving,
       count()                             AS reporting,
       round(100.0 * countIf(isDriving) / nullif(count(), 0), 1) AS pct_driving
FROM historical.q_fleet_status_27
WHERE captured_at >= now() - INTERVAL 7 DAY
GROUP BY hour
ORDER BY hour
```

Vehicles that have not moved in a week, which is the query that pays for the
whole exercise:

```sql
SELECT device_id,
       max(captured_at)  AS last_seen,
       maxIf(captured_at, isDriving) AS last_driving
FROM historical.q_fleet_status_27
WHERE captured_at >= now() - INTERVAL 30 DAY
GROUP BY device_id
HAVING last_driving < now() - INTERVAL 7 DAY
ORDER BY last_driving
```

A vehicle absent from the snapshot entirely is a different case from one present
and stationary, and the two need different handling. `reporting` in the first
query is the count that answers "how many devices told us anything", and a drop
in it is a telematics problem rather than a service one.

### 4. Build the board

- A line chart of `pct_driving` by hour, with the pull-out plan as a reference
  line if you have it as a table.
- A counter of vehicles reporting now, against fleet size from `devices`.
- The stationary-vehicles table from above, which is the one somebody acts on.
- Map (Markers) of the current fleet, coloured by `isDriving`.

Markers answer "where is everything". They do not answer "which garage is
carrying the idle vehicles", and that second question is a join rather than a
new data source. With your garage or district boundaries in a `static_geojson`
layer, a `results` query assigns each vehicle to one:

```sql
SELECT b.name AS district, b.geometry AS boundary, count(*) AS idle
FROM cached_query_12 b JOIN cached_query_27 v
  ON ST_Within(MakePoint(v.longitude, v.latitude), GeomFromGeoJSON(b.geometry))
WHERE NOT v.isDriving
GROUP BY b.name, b.geometry
```

Draw that as a Choropleth with Region Boundaries set to **Geometry column**,
Key Column `district`, Value Column `idle` and Geometry Column `boundary`.
[Build a service equity board](/use-cases/service-equity) walks the same join in
more detail, including what it costs.

## How you know it worked

Count vehicles on the yard at a known moment and compare. The number that will
be wrong first is fleet size, because `devices` includes everything registered,
including units that were sold, and nothing in the telematics data says so.

## What this does not do

| Question | Where it actually lives |
|---|---|
| Why did this bus fail | Maintenance system, fault codes, work orders |
| How many miles has it run | Odometer readings, not exposed by this connector |
| Is it due for service | Your EAM or maintenance scheduling system |
| Was it in revenue service | CAD or scheduling. `isDriving` means moving, and deadhead moves too |

That last row matters most. Telematics utilization is not revenue service, and
labelling a chart "revenue hours" from this data would put a number on a board
under a name it does not have.
