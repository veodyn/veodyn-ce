---
sidebar_position: 9
title: Build a service equity board
description: "Assigning stops and service to your own tract or district boundaries with a spatial join, shading the result as a choropleth, and what the join costs."
---

# Build a service equity board

Every equity question has the same shape: how much service does this area get,
against some attribute of the people who live there. The product's half of that
is the geometry. It will take a boundary layer you supply, work out which stops
and vehicles fall inside each region, and shade a map by whatever number you
computed per region.

The attributes are yours. Nothing here ships demographic data, and nothing here
tells you which comparison is the right one. What it does is make the assignment
reproducible, so the map is a query somebody can read instead of a shapefile
somebody made once.

## What has to be true

You supply the boundaries. Census tracts, council districts, planning areas,
whatever the analysis is framed in. They arrive as GeoJSON, in a directory the
Static GeoJSON connector reads, and the demographic or equity attributes you
intend to compare against come with them as feature properties.

Adding a layer is an operator action. The connector reads a local directory:
a `manifest.json` naming each layer, and one GeoJSON FeatureCollection file per
layer beside it. Somebody with access to that directory has to put the file
there. It is not an upload in the interface, so plan for one round trip with
whoever runs the deployment.

The host needs SpatiaLite. The spatial predicates live in a SQLite extension
the query service loads at runtime. Where it is absent, plain SQL over query
results is unaffected and a query calling `ST_Within` fails with SQLite's own
"no such function" error. Operators install `libsqlite3-mod-spatialite` on Debian
or Ubuntu, `libspatialite` from Homebrew on macOS, and point
`REDASH_SPATIALITE_LIBRARY_PATH` at it where it sits outside the loader's search
path. See [Spatial joins across query
results](/connectors#spatial-joins-across-query-results).

Point-in-polygon is not the only assignment rule, and picking it is a choice.
A stop inside a tract is served by that tract's row. A rider who walks four
minutes across a tract line to reach it is not. Whether that matters depends on
the question, and if it does, the fix is a buffered boundary computed before the
data gets here rather than a different predicate.

## Before you start

- Boundary GeoJSON, with an id or name property per region, and whatever
  attributes the comparison needs.
- A stop list, a route list, or whatever you are assigning: usually the `stops`
  table out of your [static GTFS archive](/use-cases/static-gtfs-archive).
- Agreement on the denominator before anybody builds anything. Stops per tract,
  trips per tract and revenue hours per tract are three different boards, and the
  argument about which one is fair is worth having first.

## The steps

### 1. Land the boundary layer

The layer directory holds `manifest.json` mapping each layer id to its metadata,
with the GeoJSON file beside it. Once it is there, the connector enumerates what
it can see:

```json
{"resource": "list"}
```

And a read returns one row per feature:

```json
{"layers": ["council_districts"]}
```

| Column | Holds |
|---|---|
| `layer` | Which layer the row came from, so a union across several stays legible |
| `feature_id`, `name` | The feature's `id` and `name` properties |
| `geometry` | The GeoJSON geometry, as a string. This is the column both the join and the map read |
| `properties` | Every remaining property as JSON, which is where your tract attributes arrive |
| `geometry_type`, `bbox`, `line`, `mode`, `color` | The rest, lifted or computed |

Your own attributes land in `properties` rather than as columns of their own, so
pull the ones you need out of that JSON in the next step.

### 2. Get the point side into a query

For stops, that is a projection off the archive:

```json
{"table": "stops", "columns": ["stop_id", "stop_name", "stop_lat", "stop_lon"]}
```

For anything whose coordinates arrive packed into another value, unpack them
first. Waze alerts carry a `location` JSON string instead of two numeric columns,
and the join needs numbers.

### 3. Assign points to regions

Both reads are now cached results, and a `results` data source joins them:

```sql
SELECT b.name          AS district,
       b.geometry      AS boundary,
       count(*)        AS stops
FROM cached_query_12 b
JOIN cached_query_34 s
  ON ST_Within(MakePoint(s.stop_lon, s.stop_lat), GeomFromGeoJSON(b.geometry))
GROUP BY b.name, b.geometry
```

Three details decide whether this works:

- `MakePoint` takes longitude first. Latitude first produces a point somewhere
  else entirely, and on a coordinate pair like 34 and -118 the result is a map
  with nothing on it, not an error.
- Geometry travels as text. `GeomFromGeoJSON` is what turns the `geometry` column
  into something a predicate can read.
- Carry `b.geometry` through the select and the group by. The map in step 5 reads
  it off the result, so a query that only returns names and counts has nothing to
  draw.

### 4. Deal with what it costs

There is no spatial index behind this. The join tests every point against every
polygon, so the work is the product of the two row counts. A few hundred stops
against forty districts is instant. A hundred thousand points against two thousand
tracts is a different query, and you will notice.

The lever is the query, and there are two moves:

- Put a `LIMIT` on the point side while you are still drafting. You are checking
  that the predicate assigns anything at all, and fifty rows answers that as well
  as fifty thousand.
- Filter on an ordinary property column before the predicate runs. A route id, an
  agency, or a latitude and longitude range narrows the point side to rows that
  could plausibly match, and a bounding-box filter is cheap where the polygon test
  is not.

Once it is right, put it on a schedule so it is not recomputing every time
somebody opens the dashboard.

### 5. Draw it

Add a Choropleth visualization and set **Region Boundaries** to *Geometry column*,
which is the mode that draws one region per result row instead of shading a
bundled world map. Then:

| Control | Set to |
|---|---|
| **Key Column** | `district`. It names each region, and there is nothing to match it against: every row is its own region |
| **Value Column** | `stops`, or whatever the number is. Rows whose value is empty or non-numeric stay unshaded |
| **Geometry Column (GeoJSON)** | `boundary`. Each cell holds one region, either a bare geometry or a whole Feature |

A row whose geometry the map cannot read is left off it, and the visualization
says how many rows that was rather than drawing a quietly incomplete map. If that
count is not zero, the geometry column is the place to look: a truncated string,
or a column that turned out to hold something other than GeoJSON.

### 6. Put the comparison beside the map

The map shades one number. An equity finding is two numbers and a reason to
compare them, so give the board both:

- The service measure per region, which is the choropleth.
- The attribute per region, out of the `properties` column, as a table or a
  second shaded map.
- The ratio, computed once in the same `results` query, so nobody is dividing two
  charts by eye.

Name the denominator in the widget title. "Stops per 1,000 residents" and "stops
per square mile" answer different questions and look identical on a map.

## How you know it worked

Pick two regions you know well, one dense and one not, and check their counts by
hand against a list of stops. Then check a region on the edge of your service
area, because that is where an assignment rule shows its seams: a stop sitting
metres outside a boundary is the case that tells you whether the map is measuring
what you think.

Confirm the totals close. The sum of the per-region counts, plus whatever fell
outside every boundary, should equal the row count of the point side. A gap means
either overlapping polygons counting a stop twice, or a boundary layer that does
not cover your whole service area.

## What takes it off the air

| What happened | What you see |
|---|---|
| SpatiaLite is not installed on the host | The query fails with "no such function: ST_Within". Plain SQL over the same results still runs |
| The coordinates went in latitude-first | An empty map, with no error anywhere. Check `MakePoint` before anything else |
| The geometry column was not carried through the group by | The map says it needs a geometry column, or reads no geometry from the one it was given |
| The point side grew | A query that used to answer in seconds and now does not. The row counts multiplied; filter, do not wait |
| The boundary file was replaced with a different vintage | Region names that no longer join, or counts that moved for no reason visible in the data |

## What this does not do

It does not supply demographic data, and it takes no view on which population
denominator is correct. Both of those are yours, and they are the part of an
equity analysis that gets argued about.

It does not compute accessibility. Stops inside a boundary are not the same as
service a person can reach, which depends on frequency, span, walk network and
transfers. The map is an input to that question and not an answer to it, and
labelling it "access" would claim otherwise.
