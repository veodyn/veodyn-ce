---
sidebar_position: 9
title: Build a service equity board
description: "Assigning stops and service to your own tract or district boundaries with a spatial join, shading the result as a choropleth, and what the join costs."
---

# Build a service equity board

An equity board answers how much service an area gets, compared against some
attribute of the people who live there. The product handles the geometry side:
you supply a boundary layer, it works out which stops or vehicles fall inside
each region, and it shades a map by whatever number you computed per region.

The attributes are up to you. Nothing here ships demographic data or decides
which comparison is the right one. What you get is a reproducible assignment,
a query anyone can read later, instead of a shapefile that was processed once
in desktop GIS and can't be checked.

## What has to be true

You need boundaries as GeoJSON: census tracts, council districts, planning
areas, whatever frame the analysis uses. The demographic or equity attributes
you want to compare against should be included as feature properties on those
boundaries.

The Static GeoJSON connector reads them from a local directory containing a
`manifest.json` (naming each layer) and one FeatureCollection file per layer.
There is no upload in the interface, so someone with access to the deployment
has to place the files. Plan for one round trip with whoever operates it.

SpatiaLite has to be installed on the host, because the spatial predicates come
from a SQLite extension the query service loads at runtime. If it's absent,
plain SQL over query results still works, and a query calling `ST_Within` fails
with SQLite's own "no such function" error. Operators install
`libsqlite3-mod-spatialite` on Debian or Ubuntu, or `libspatialite` from
Homebrew on macOS, and set `REDASH_SPATIALITE_LIBRARY_PATH` if the library sits
outside the loader's search path. See
[Spatial joins across query results](/connectors#spatial-joins-across-query-results).

One caveat about the method itself. Point-in-polygon assigns a stop to the
tract it sits in, which means a rider who walks four minutes across a tract
line to reach it is not counted for their own tract. Whether that matters
depends on the question. If it does, buffer the boundaries before they get
here; there is no alternative predicate that fixes it.

## Before you start

- Boundary GeoJSON with an id or name property per region, plus whatever
  attributes the comparison needs.
- The point data you are assigning. Usually the `stops` table out of your
  [static GTFS archive](/use-cases/static-gtfs-archive).
- Agreement on the denominator. Stops per tract, trips per tract, and revenue
  hours per tract are three different boards, so settle which one is fair
  before building any of them.

## The steps

### 1. Land the boundary layer

Once the layer directory is in place, the connector can enumerate it:

```json
{"resource": "list"}
```

A read returns one row per feature:

```json
{"layers": ["council_districts"]}
```

| Column | Holds |
|---|---|
| `layer` | Which layer the row came from, so a union across several stays legible |
| `feature_id`, `name` | The feature's `id` and `name` properties |
| `geometry` | The GeoJSON geometry, as a string. Both the join and the map read this column |
| `properties` | Every remaining property as JSON, which is where your tract attributes arrive |
| `geometry_type`, `bbox`, `line`, `mode`, `color` | The rest, lifted or computed |

Note that your own attributes land inside the `properties` JSON, not as columns
of their own; extract the ones you need in the join query.

### 2. Get the point side into a query

For stops, this is a projection off the archive:

```json
{"table": "stops", "columns": ["stop_id", "stop_name", "stop_lat", "stop_lon"]}
```

If the coordinates arrive packed inside another value, unpack them first. Waze
alerts, for example, carry a `location` JSON string instead of two numeric
columns, and the join needs numbers.

### 3. Assign points to regions

Both reads are now cached results, so a `results` data source can join them:

```sql
SELECT b.name          AS district,
       b.geometry      AS boundary,
       count(*)        AS stops
FROM cached_query_12 b
JOIN cached_query_34 s
  ON ST_Within(MakePoint(s.stop_lon, s.stop_lat), GeomFromGeoJSON(b.geometry))
GROUP BY b.name, b.geometry
```

Three details matter here:

- `MakePoint` takes longitude first. With latitude first, a coordinate pair
  like 34 and -118 lands somewhere else entirely and you get an empty map, not
  an error.
- The `geometry` column is text, so it has to go through `GeomFromGeoJSON`
  before a predicate can read it.
- Keep `b.geometry` in the select and the group by. The map in step 5 reads it
  off the result; a query that only returns names and counts has nothing to
  draw.

### 4. Deal with what it costs

There is no spatial index behind this join. Every point is tested against
every polygon, so the work is the product of the two row counts. A few hundred
stops against forty districts is instant; a hundred thousand points against
two thousand tracts is slow enough to be a problem.

Two ways to keep it manageable:

- While drafting, put a `LIMIT` on the point side. Fifty rows is enough to
  check that the predicate assigns anything at all.
- Filter on an ordinary property column before the predicate runs. A route id,
  an agency, or a latitude/longitude range narrows the point side cheaply,
  and the polygon test then only runs on rows that could plausibly match.

Once the query is right, schedule it, so the join is not recomputed every time
the dashboard opens.

### 5. Draw it

![A choropleth on a query's read view. This capture shades the bundled world map; the geometry column mode below draws one region per result row instead](/img/screenshots/choropleth-view.png)

Add a Choropleth visualization and set **Region Boundaries** to *Geometry
column*. This mode draws one region per result row instead of shading the
bundled world map. Then:

| Control | Set to |
|---|---|
| **Key Column** | `district`. It labels each region; there is nothing to match it against, since every row is its own region |
| **Value Column** | `stops`, or whatever the number is. Rows whose value is empty or non-numeric stay unshaded |
| **Geometry Column (GeoJSON)** | `boundary`. Each cell holds one region, either a bare geometry or a whole Feature |

If a row's geometry can't be read, that region is left off the map and the
visualization reports how many rows it skipped. A non-zero count usually means
a truncated string or a column that turned out to hold something other than
GeoJSON.

### 6. Put the comparison beside the map

The map shades one number, and an equity finding needs two plus a reason to
compare them. Give the board:

- The service measure per region (the choropleth).
- The attribute per region, pulled out of the `properties` column, as a table
  or a second shaded map.
- The ratio, computed in the same `results` query rather than left for readers
  to estimate off two charts.

Name the denominator in the widget title. "Stops per 1,000 residents" and
"stops per square mile" answer different questions but look identical on a
map.

## How you know it worked

Pick two regions you know well, one dense and one not, and check their counts
by hand against a stop list. Then check a region on the edge of your service
area. Edge regions are where the assignment rule gets tested: a stop sitting
metres outside a boundary tells you whether the map measures what you intended.

Also confirm the totals close. Per-region counts, plus whatever fell outside
every boundary, should sum to the row count of the point side. A gap means
overlapping polygons counted a stop twice, or the boundary layer doesn't cover
the whole service area.

## What takes it off the air

| What happened | What you see |
|---|---|
| SpatiaLite is not installed on the host | The query fails with "no such function: ST_Within". Plain SQL over the same results still runs |
| The coordinates went in latitude-first | An empty map, with no error anywhere. Check `MakePoint` before anything else |
| The geometry column was not carried through the group by | The map says it needs a geometry column, or reads no geometry from the one it was given |
| The point side grew | A query that used to answer in seconds now doesn't. Row counts multiplied; add a filter |
| The boundary file was replaced with a different vintage | Region names that no longer join, or counts that moved for no reason visible in the data |

## What this does not do

It doesn't supply demographic data, and it takes no view on which population
denominator is correct. Both are yours to argue about.

It also doesn't compute accessibility. Stops inside a boundary is not the same
thing as service a person can reach, which depends on frequency, span, the
walk network, and transfers. Treat the map as an input to that question, and
avoid labelling it "access".
