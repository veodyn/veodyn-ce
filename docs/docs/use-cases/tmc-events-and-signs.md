---
sidebar_position: 11
title: Put a traffic management center on your board
description: "Reading active events and dynamic message sign status from a TMDD v3.03d center: the connection facts to ask for, the three queries, and the four traps in the standard."
---

# Put a traffic management center on your board

A traffic management center holds the operating picture for the freeway network:
what is closed, what is queued, what the signs are saying. TMDD
Center-to-Center is how it hands that to another system. This gets it onto
dashboards you own, beside your transit and weather data, without anyone at the
center changing anything.

## What has to be true

The center speaks TMDD v3.03d over C2C SOAP, and it is willing to answer
request messages from your organization id. That is all. Nothing here can change
anything at the center: the standard's control and command operations are not
implemented, so a data source of this type can only read.

## Before you start

Get these from whoever runs the center. Collect them in one ask: chasing them one
at a time turns this into a slow back-and-forth with somebody else's inbox.

| Ask for | Why |
|---|---|
| The C2C SOAP endpoint URL | Required |
| An organization id for you, 1 to 32 characters | Required, sent on every request so the center can attribute it |
| A user id and password, or confirmation that neither is needed | Optional, but only as a pair. Half a credential builds a request the center's own schema rejects |
| Whether they reject an empty `SOAPAction` header | Every operation in the published WSDL declares the same ambiguous value. Default is empty; if they refuse it, two apostrophes go in the field instead |
| Their `messageTypeId` and version, if they document any | Both default to `1`, which is schema-valid and undefined. Only their documentation can say otherwise |
| Their CA bundle, if they run a private CA | Common. Trusting it explicitly beats turning verification off |

## The steps

### 1. Add the data source

**Admin → Data Sources → New Data Source**, type TMDD Center-to-Center. Fill in
what you collected above, then **Test Connection** before saving.

Two settings deserve a decision, not a default:

- **Max Response Size (MB)**, default 10, enforced while the body is arriving
  rather than after it has all been read.
- **Max Records**, default 10000. This is not a row limit. Exceeding it is an
  error naming the count, not a shortened table, so a partial answer can never
  be mistaken for the complete one. When you hit it, either raise it or narrow
  the query.

### 2. Write the three queries

A query against this source is a JSON resource selector, not SQL:

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
`limit` only, and passing `since` there fails the query and says so instead of
being quietly ignored.

:::caution `since` and `limit` narrow what you read, not what the center sends

Both are applied to the decoded records on this side. No request type in the
published v3.03d schema carries a result count or an updated-since filter, so
sending one would risk silently returning the wrong rows.

The consequence to plan for: a large events feed transfers in full on every
poll, however small a `limit` you ask for. Set the schedule accordingly, and
give the center's operators a heads-up about your polling interval.

:::

### 3. Schedule them

Attach a [refresh schedule](/features/queries#the-query-actions-menu) to each
query. Events move; a sign inventory does not. Polling inventory every minute
transfers the whole thing every minute for a table that changes when they
install a sign.

A sensible starting point is events on the tightest cadence the center is
comfortable with, `dms_status` a little slower, and `dms_inventory` daily.

Then switch on [historical capture](/use-cases/history-capture) for the source.
Events are the archetypal accumulate-and-trend input: the live table answers what
is closed right now, and the captured one answers how many closures that corridor
had last quarter and how long they ran. Nothing recovers a month you did not
capture, so this is a decision worth making at setup rather than the first time
somebody asks.

The second checkbox, **Capture manual runs too**, is useful here in a narrow way.
Turn it on while you are still testing the query, so you can press Refresh and
see rows land without waiting for the schedule, then decide whether to leave it
on. Left on permanently it puts uneven samples into the same table the trend is
computed from.

Once **Monitor → Schedules** shows these three keeping up, org-wide punctuality
for every scheduled query in the instance is on that same page: see
[Schedules](/features/schedules).

### 4. Map the enumerations in the query, not in your head

`severity`, `status` and `direction` on `events`, `direction` on
`dms_inventory`, and `oper_status` on `dms_status` are enumerated fields, and
the schema lets each arrive either as a bounded integer or as a string token.
Whichever form the center sends is what lands in the column. The connector does
not translate, because the standard asserts no mapping between the two arms and
one type in the same bundle disproves the obvious guess.

So do the mapping where you can see it. In a `results` query over the cached
result, or in the visualization:

```sql
SELECT event_id,
       CASE severity WHEN '1' THEN 'minor' WHEN '2' THEN 'major' ELSE severity END AS severity,
       status, direction, latitude, longitude, update_time
FROM cached_query_11
```

Use your center's own documented mapping. There is no universal one, which is
exactly why the connector does not pretend there is.

### 5. Build the dashboard

These widgets carry most of the value:

- A map of active events. `latitude` and `longitude` come back as decimal
  degrees, divided by 1,000,000 from the integers the center sent. That factor
  is inferred from the schema's value bounds rather than documented, so every
  coordinate column has a `latitude_raw` / `longitude_raw` sibling holding the
  integer as it arrived. If your center scales differently, the map will be
  visibly wrong and the raw column is how you fix it.
- A table of sign status, joined to inventory for the sign's location and name.
  `dms_status` carries no location of its own.
- A counter of events by severity, using the mapping from step 4.
- Events per jurisdiction, where a map of dots is not what the conversation
  needs. With jurisdiction boundaries in a `static_geojson` layer, a `results`
  query joins the decoded coordinates to them with
  `ST_Within(MakePoint(e.longitude, e.latitude), GeomFromGeoJSON(b.geometry))`
  and a Choropleth shades the result from its geometry column. That turns the
  center's feed into something a city can be shown its own row of.

### 6. Read `current_message` for what it is

`dms_status.current_message` is the center's own string, returned exactly as
sent. The published schema types it as an unrestricted string, so it may contain
NTCIP MULTI markup: `[nl]`, `[np]`, `[pt50o30]`, `[jl3]`. Nothing strips or
interprets it.

If a dashboard needs rendered text, decode it downstream in the query. This
differs from the [NTCIP connector](/use-cases/dms-ntcip), which polls a sign
directly and hands you a raw `message_multi` and a decoded `message_text` side by
side.

## How you know it worked

The events query returns rows with plausible coordinates on your own network,
the sign table matches what an operator at the center sees on their own screen,
and a scheduled run has completed without hitting **Max Records**.

## What this does not do

It does not post anything to the center, it does not subscribe to their event
stream, and it does not reconcile their event ids with anyone else's. What it
gives you is their operating picture, in your warehouse, on your schedule, next
to the rest of your data.
