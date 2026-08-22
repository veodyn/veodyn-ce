---
sidebar_position: 11
title: Put a traffic management center on your board
description: "Reading active events and dynamic message sign status from a TMDD v3.03d center: the connection facts to ask for, the three queries, and the four traps in the standard."
---

# Put a traffic management center on your board

A traffic management center holds the operating picture for the freeway network:
what is closed, what is queued, and what the signs are showing. TMDD
Center-to-Center is the interface it uses to hand that picture to another
system. You can read it into dashboards you own, beside your transit and
weather data, without anyone at the center changing anything.

## What has to be true

The center has to speak TMDD v3.03d over C2C SOAP and be willing to answer
request messages from your organization id. Nothing else is required of them.
The standard's control and command operations are not implemented here, so a
data source of this type can only read; it cannot change anything at the center.

## Before you start

Get these from whoever runs the center, and ask for all of them at once.
Collecting them one at a time means waiting on another organization's inbox for
each round trip.

| Ask for | Why |
|---|---|
| The C2C SOAP endpoint URL | Required |
| An organization id for you, 1 to 32 characters | Required, sent on every request so the center can attribute it |
| A user id and password, or confirmation that neither is needed | Optional, but only as a pair. Supplying one without the other builds a request the center's own schema rejects |
| Whether they reject an empty `SOAPAction` header | Every operation in the published WSDL declares the same ambiguous value. Default is empty; if they refuse it, put two apostrophes in the field instead |
| Their `messageTypeId` and version, if they document any | Both default to `1`, which is schema-valid but undefined, so use their documented values if they have them |
| Their CA bundle, if they run a private CA | This is common. Trusting the bundle explicitly is better than turning verification off |

## The steps

### 1. Add the data source

**Admin → Data Sources → New Data Source**, type TMDD Center-to-Center. Fill in
what you collected above, then **Test Connection** before saving.

Two settings are worth choosing rather than leaving at their defaults:

- **Max Response Size (MB)**, default 10, enforced while the body is arriving
  rather than after it has all been read.
- **Max Records**, default 10000. Going over it raises an error that names the
  count; it does not hand back a shortened table, so a partial answer cannot be
  mistaken for a complete one. Raise the limit or narrow the query when that
  happens.

### 2. Write the three queries

You write queries here as JSON resource selectors instead of SQL:

```json
{ "resource": "events", "params": { "since": "2026-01-01T00:00:00Z", "limit": 100 } }
```

```json
{ "resource": "dms_inventory", "params": { "limit": 500 } }
```

```json
{ "resource": "dms_status", "params": { "limit": 500 } }
```

`events` and `dms_status` accept `since` and `limit`. `dms_inventory` accepts
`limit` only; passing `since` there fails the query with an error rather than
being ignored.

:::caution `since` and `limit` are applied after the full response arrives

Both filters run against the decoded records on this side. No request type in
the published v3.03d schema carries a result count or an updated-since filter,
so sending one would risk silently returning the wrong rows.

A large events feed therefore transfers in full on every poll, however small a
`limit` you set. Choose the schedule with that in mind, and tell the center's
operators what polling interval you are using.

:::

### 3. Schedule them

Attach a [refresh schedule](/features/queries#the-query-actions-menu) to each
query. Events change constantly and a sign inventory rarely does. Polling
inventory every minute transfers the whole table every minute, when it only
changes if the center installs a sign.

A sensible starting point is events on the tightest cadence the center is
comfortable with, `dms_status` a little slower, and `dms_inventory` daily.

Then switch on [historical capture](/use-cases/history-capture) for the source.
The live events table answers what is closed right now; the captured table
answers how many closures a corridor had last quarter and how long they ran.
A month you did not capture cannot be recovered, so turn capture on at setup
rather than the first time someone asks for a trend.

The second checkbox, **Capture manual runs too**, has a narrow use here. Turn
it on while you are still testing the query, so you can press Refresh and see
rows land without waiting for the schedule, then decide whether to leave it on.
Left on permanently, it mixes unevenly spaced samples into the same table the
trend is computed from.

**Monitor → Schedules** shows whether these three are keeping up, along with
punctuality for every scheduled query in the instance. See
[Schedules](/features/schedules).

![The Schedules page listing every scheduled query and its punctuality](/img/screenshots/schedules.png)

### 4. Map the enumerations in the query, not in your head

`severity`, `status` and `direction` on `events`, `direction` on
`dms_inventory`, and `oper_status` on `dms_status` are enumerated fields, and
the schema lets each arrive either as a bounded integer or as a string token.
Whichever form the center sends is what lands in the column. The connector does
not translate between them: the standard asserts no mapping between the two
arms, and at least one type in the same bundle contradicts the mapping you
would guess.

Map the values yourself, in a `results` query over the cached result or in the
visualization:

```sql
SELECT event_id,
       CASE severity WHEN '1' THEN 'minor' WHEN '2' THEN 'major' ELSE severity END AS severity,
       status, direction, latitude, longitude, update_time
FROM cached_query_11
```

Use your center's own documented mapping; there is no universal one.

### 5. Build the dashboard

Useful widgets to build:

- A map of active events. `latitude` and `longitude` come back as decimal
  degrees, divided by 1,000,000 from the integers the center sent. That factor
  is inferred from the schema's value bounds rather than documented, so every
  coordinate column has a `latitude_raw` / `longitude_raw` sibling holding the
  integer as it arrived. A center that scales differently produces a visibly
  wrong map, and you can rescale from the raw column.
- A table of sign status, joined to inventory for the sign's location and name.
  `dms_status` carries no location of its own.
- A counter of events by severity, using the mapping from step 4.
- Events per jurisdiction, for readers who want counts rather than a map of
  dots. With jurisdiction boundaries in a `static_geojson` layer, a `results`
  query joins the decoded coordinates to them with
  `ST_Within(MakePoint(e.longitude, e.latitude), GeomFromGeoJSON(b.geometry))`,
  and a Choropleth shades the result from its geometry column.

### 6. Read `current_message` for what it is

`dms_status.current_message` is the center's own string, returned exactly as
sent. The published schema types it as an unrestricted string, so it may contain
NTCIP MULTI markup such as `[nl]`, `[np]`, `[pt50o30]` or `[jl3]`. The
connector does not strip or interpret any of it.

If a dashboard needs rendered text, decode it downstream in the query. This
differs from the [NTCIP connector](/use-cases/dms-ntcip), which polls a sign
directly and returns a raw `message_multi` and a decoded `message_text` side by
side.

## How you know it worked

The events query returns rows with plausible coordinates on your own network.
The sign table matches what an operator at the center sees on their own screen.
A scheduled run completes without hitting **Max Records**.

## What this does not do

It does not post anything to the center, subscribe to their event stream, or
reconcile their event ids with anyone else's. What you get is a read-only copy
of their operating picture, refreshed on your own schedule.
