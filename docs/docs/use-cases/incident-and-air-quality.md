---
sidebar_position: 13
title: Build an incident and air quality picture
description: "Traffic alerts, air quality and weather on one board: the three connectors, the parameters they take, the history worth accumulating, and the correlation not to claim."
---

# Build an incident and air quality picture

Three connectors, one board: what is happening on the network, what the air is
doing, and what the weather is doing to both. It is the fastest genuinely useful
dashboard to build on a new node, because every input is an API call rather than
a system integration.

## What has to be true

Each of the three sources is configured once as a data source, and the
per-request values (a coordinate, an alert type) are query parameters rather
than connector configuration. One configured connector serves every query
against it.

| Connector | Needs | Gives you |
|---|---|---|
| **Waze Traffic Alerts** | A partner feed URL, with the token and coverage polygon embedded in it | `type`, `subtype`, `reliability`, `street`, `city`, `location`, `pubMillis` |
| **AirNow Air Quality** | An API key | `ReportingArea`, `ParameterName` (PM2.5, O3), `AQI`, `Category`, `Latitude`, `Longitude` |
| **OpenWeatherMap** | An App ID | Current conditions by coordinate |

The Waze feed's coverage polygon comes with the URL, so the feed decides your
extent. If it covers the wrong area, that is a conversation with whoever issued
it, not a setting here.

In the LA region the [GO511 connector](/connectors) covers much of the same
ground from the official side: incidents, roadwork, park-and-ride lots, cameras
and mainline route speeds, on an API key rather than a partner feed. Running both
is not redundant. Waze is what drivers report, GO511 is what the agencies have
confirmed, and the two disagreeing is itself information.

## Before you start

The three credentials, and the coordinates of the places you actually care
about: downtown, the operations centre, two or three corridors. Air quality is
reported by area, so a handful of representative points is the right shape.

## The steps

### 1. Add the data sources

**Admin → Data Sources**, one each. Use **Test Connection** before saving. The
AirNow and OpenWeatherMap keys are stored encrypted, like any other data source
credential.

### 2. Write the queries

Each is a JSON resource selector.

Alerts worth acting on, filtered on the connector's own parameters:

```json
{ "resource": "alerts", "params": { "type": "ACCIDENT", "min_reliability": 5 } }
```

Slowdowns, which is a different resource and a different shape (`speed`,
`regularSpeed`, `delaySeconds`, and a polyline):

```json
{ "resource": "irregularities", "params": { "min_reliability": 5 } }
```

Air quality at a point, with the radius in miles:

```json
{ "resource": "observations", "params": { "latitude": "34.05", "longitude": "-118.24", "distance": "10" } }
```

`min_reliability` is doing real work in the first two. Crowd-sourced alerts
include a lot of low-confidence reports, and a board that shows every one of
them is a board of noise.

### 3. Put them on one grid

- Map (Markers) over the alerts, coloured by `type`. `location` arrives as a
  JSON string of `{x: lon, y: lat}`, so pull the two numbers out in a `results`
  query before mapping.
- A choropleth of alerts per council district, which is the version of that map
  somebody can act on. Once the two numbers are their own columns, a boundary
  layer read from `static_geojson` joins to them in the same `results` source:
  `ST_Within(MakePoint(a.lon, a.lat), GeomFromGeoJSON(b.geometry))`, grouped by
  district, with `b.geometry` carried through for the visualization's Geometry
  Column. "Twelve open alerts" is a number; "nine of them in one district" is a
  decision. See [Spatial joins across query
  results](/connectors#spatial-joins-across-query-results).
- A counter of open accidents, and another of alerts above your reliability
  floor.
- A table of irregularities sorted by `delaySeconds`, which is the closest thing
  here to a ranked list of where the network hurts.
- A counter for AQI with its `Category` name beside it, per monitored area.

Give the dashboard a short auto-refresh. This is the one board where a stale
number is actively misleading, because everything on it is about right now.

### 4. Accumulate the history you will want later

Live is what the board is for; the questions that arrive a month later are
comparative. Switch on [historical capture](/use-cases/history-capture) for these
sources and put the queries on a schedule, which is what gives the counts below
an even time axis, and you can then ask things the live board cannot answer:

```sql
SELECT toStartOfHour(captured_at) AS hour,
       type,
       count() AS alerts
FROM historical.q_waze_accidents_23
WHERE captured_at >= now() - INTERVAL 30 DAY
GROUP BY hour, type
ORDER BY hour
```

Mind what a snapshot count means: each capture holds the alerts open at that
moment, so counting rows over time counts open-alert-minutes, not incidents. To
count incidents, deduplicate on whatever identifies one and take its first
appearance.

## How you know it worked

Compare the board against a source you trust for the same minute: a traffic
camera, the state DOT's public map, or someone looking out of a window. Alerts
are crowd-sourced, and calibrating your reliability floor against reality once is
worth more than tuning it by feel afterwards.

## The correlation not to claim

Putting AQI next to traffic invites the sentence "congestion is driving air
quality here", and this board cannot support it. AirNow reports at monitoring
areas, which are regional and sparse, and the AQI at an area is dominated by
regional conditions and, in fire season, by smoke from hundreds of miles away.
Roadway-level air quality is a different measurement with different equipment.

Show the two side by side, which is honest and useful, and leave the causal
claim to a study designed to make it.

## What this does not do

It does not detect incidents, verify them, or dispatch anything. Every alert
here is someone else's report, arriving with a reliability score that is the
only thing standing between your board and the noise floor.
