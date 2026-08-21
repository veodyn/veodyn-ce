---
sidebar_position: 16
title: Track fleet utilization from telematics
description: "What the Geotab connector actually returns, the utilization measures you can build from it, and the maintenance questions it cannot answer."
---

# Track fleet utilization from telematics

Telematics answers where the fleet is and whether it is moving. That supports a
narrow, useful set of questions: how many vehicles were in service at 7am, which
ones did not move all week, how utilization looks against the pull-out plan.

It does not support maintenance analytics. The last section of this page lists
what that rules out.

## What has to be true

The [Geotab connector](/connectors) exposes two resources:

| Resource | Returns |
|---|---|
| `device_status_info` | `device` (a JSON object with an id), `latitude`, `longitude`, `bearing`, `speed`, `isDriving`, `dateTime` |
| `devices` | Device objects with id, name, serial number, VIN and the rest of the inventory |

Those two are the whole surface: no engine fault, no odometer, no fuel, no
diagnostic code, no maintenance record. Questions about failures or service
intervals belong to your maintenance system or to Geotab's own tooling, and no
query here reaches them.

`device_status_info` returns a snapshot of the fleet as it stands right now.
Every utilization measure below is built on
[captured](/use-cases/history-capture) snapshots, and its resolution is the
interval between them. Capture them on a schedule, since the arithmetic in step
3 assumes a uniform time axis. Manual runs are captured too, and they land in
the same table at whatever moments someone pressed the button, which turns
"vehicles in service at 7am" into an average over an uneven sample.

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
anyone will actually look. That checkbox appears on every source type; it
matters here because the connector only ever returns the current state.

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
`results` query and join the two together there. Every downstream board then
reads that query instead of handling the JSON itself.

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

Vehicles that have not moved in a week:

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

A vehicle absent from the snapshot is a different case from one that is present
and stationary, and the two need different handling. `reporting` in the first
query counts how many devices told you anything, so a drop in it points at
telematics rather than at service.

### 4. Build the board

- A line chart of `pct_driving` by hour, with the pull-out plan as a reference
  line if you have it as a table.
- A counter of vehicles reporting now, against fleet size from `devices`.
- The stationary-vehicles table from above.
- Map (Markers) of the current fleet, coloured by `isDriving`.

Markers show where everything is. Working out which garage is carrying the idle
vehicles takes a join rather than another data source. With your garage or
district boundaries in a `static_geojson` layer, a `results` query assigns each
vehicle to one:

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

Count vehicles on the yard at a known moment and compare. Fleet size is usually
the first number to come out wrong, because `devices` includes everything
registered, sold units included, and nothing in the telematics data marks them.

## What this does not do

| Question | Where it actually lives |
|---|---|
| Why did this bus fail | Maintenance system, fault codes, work orders |
| How many miles has it run | Odometer readings, not exposed by this connector |
| Is it due for service | Your EAM or maintenance scheduling system |
| Was it in revenue service | CAD or scheduling. `isDriving` means moving, and deadhead moves too |

The last row is the one that causes trouble. Telematics utilization is not
revenue service, so a chart built from this data should not be labelled
"revenue hours".
