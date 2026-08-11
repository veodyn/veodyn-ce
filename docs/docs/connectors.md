---
sidebar_position: 5
title: Connectors
description: "The public transportation connectors: what each one reads, its type string, and what configuration it needs."
---

# Connectors

Alongside the standard SQL and warehouse data sources, the query service ships
a set of connectors for transportation, traffic, weather and fleet APIs.
Each is a query-service data source type: queries against it are JSON endpoint
descriptors rather than SQL, and the fields below are entered once when the
data source is created (see [Data Sources](/admin/data-sources)).

| Connector | Type string | Reads | Configuration |
|---|---|---|---|
| GTFS-Realtime | `gtfs_realtime` | Vehicle positions from a GTFS-Realtime websocket feed | Feed URL (required); optional route id to display-name map (JSON); default sample window in seconds |
| GBFS Bikeshare | `gbfs` | Station information and status from a GBFS discovery document | Discovery URL (`gbfs.json`, required); feed language (default `en`) |
| Waze Traffic Alerts | `waze` | Alerts and irregularities from a Waze partner feed | Feed URL (required; the partner token and coverage polygon are embedded in it, so there is no shared default) |
| AirNow Air Quality | `airnow` | Current AQI observations by coordinate | Observation API URL (default provided); API key (required, secret) |
| OpenWeatherMap | `openweathermap` | Current weather by coordinate | API URL (default provided); App ID / API key (required, secret) |
| TrafficLand Cameras | `trafficland` | Camera video feeds | API base URL (default provided); API key (required, secret); system name (required) |
| Geotab Fleet | `geotab` | Fleet device status and inventory | Server (default provided); database, username and password (all required, password stored as secret); default results limit |
| MetroCloudAlliance Transit | `metrocloudalliance` | Transit predictions, stops, carriers and vehicle locations | API base URL (default provided); API key (required, secret) |
| NTCIP 1203 DMS | `ntcip_dms` | Dynamic message sign identity, status and current message, polled over SNMP | SNMP community string (required, secret); SNMP version (`2c` default, or `1`); device list (JSON, required); per-device timeout (default 2s); max devices polled (default 50) |
| TMDD Center-to-Center | `tmdd` | Active traffic events, and dynamic message sign inventory and status, from a traffic management center over TMDD v3.03d C2C SOAP | C2C SOAP endpoint URL (required); organization id (required); user id and password (optional, but only as a pair, password stored as secret); TMDD version (`3.03d`, the only one implemented); SOAPAction header value (empty by default); message type id and version (both default `1`); TLS verification (on by default) and an optional CA bundle path; max response size (default 10 MB); max records (default 10000) |
| Static GeoJSON | `static_geojson` | Layers (rail lines, bus routes, service areas, or other named feature sets) from a local GeoJSON directory | Layer directory path (required) |

Fields marked "secret" are stored encrypted, the same way any other data
source credential is (see [Data Sources: Notes for operators](/admin/data-sources#notes-for-operators)).

Latitude/longitude, route ids and similar per-request values are query
parameters, not connector configuration, so one configured connector serves
every query against it rather than one location or route being baked in.

## NTCIP 1203 DMS: a worked configuration example

This connector polls dynamic message signs (highway signs that display
scrolling text) over SNMP, per the NTCIP 1203 standard. Its device list is a
JSON value rather than a single host and port, which the table above cannot
show in one cell, so a full example is worth spelling out.

Configuring a data source of this type means filling in:

- **SNMP Community String**: the read community configured on the signs
  themselves (a typical default is `public`, but any deployment worth
  polling has changed it). SNMP v1 and v2c send this string in clear text,
  so only point this connector at a network path you control, never across
  the open internet.
- **SNMP Version**: `2c` unless the signs only answer to `1`.
- **Devices (JSON)**: the poll targets, one object per sign:

  ```json
  [
    { "name": "I-5 NB MP12", "host": "10.0.1.20", "port": 161 },
    { "name": "I-5 SB MP12", "host": "10.0.1.21" },
    { "name": "US-101 NB MP4", "host": "10.0.2.5", "port": 1610 }
  ]
  ```

  `port` defaults to `161`, the standard SNMP port, when omitted (the second
  entry above). `name` is what a query's `params.devices` selects by; it does
  not have to match anything on the device itself.
- **Per-Device Timeout**: seconds allowed for one sign's SNMP transaction
  before giving up on it and moving to the next device. A sign that times
  out, or fails for any other reason, is marked `error`, not `skipped`:
  `skipped` is reserved for a sign never attempted at all, because the
  whole-query deadline (`request_timeout`, capped at 30 seconds) had
  already run out before its turn came. Reading a result table, `error`
  means "this sign was reached and something went wrong with it"; `skipped`
  means "this sign was never reached, raise `request_timeout` or poll fewer
  devices per query."
- **Max Devices Polled**: a fleet-size cap applied after any
  `params.devices` selection, so a query against "all devices" cannot poll
  more than this many signs.

A query against this data source is a JSON resource selector, the same
pattern the other transportation connectors use:

```json
{ "resource": "dms_status", "params": { "devices": ["I-5 NB MP12"] } }
```

`resource` is one of `dms_identity`, `dms_status` or `dms_message`. Omitting
`params.devices` polls every configured device (subject to the max-devices
cap above). Every row carries a `poll_status` of `healthy`, `error` or
`skipped`, so a single unreachable sign in a fleet of fifty does not fail
the whole query, it shows up as one row saying so.

## TMDD Center-to-Center: a worked configuration example

This connector polls a traffic management center over the TMDD v3.03d
Center-to-Center SOAP interface and reads three things: active traffic events,
dynamic message sign inventory, and dynamic message sign status. Everything it
sends is a request message. The standard's control and command operations are
deliberately not implemented, so a data source of this type cannot change
anything at the center.

Configuring one means filling in:

- **C2C SOAP Endpoint URL** (required): the center's Center-to-Center SOAP
  endpoint.
- **Organization ID** (required): this system's own organization identifier, 1
  to 32 characters, sent in every request so the center can attribute it.
- **User ID** and **Password**: optional, but only as a pair. The
  authentication block a request carries is optional, and both of its children
  are mandatory once it is present, so half a credential can only build a
  request the center's own schema rejects. Give both or leave both empty. The
  user id is 1 to 32 characters, the password 1 to 256, and the password is
  stored encrypted.
- **TMDD Version**: `3.03d` is the only version implemented. Anything else is
  refused when a query runs, rather than sent and hoped for.
- **SOAPAction Header Value**, **Message Type ID** and **Message Type
  Version**: three fields that exist because a value has to go out and the
  published XSD and WSDL do not settle which. See below.
- **Verify TLS Certificate** and **CA Bundle Path**: agency centers commonly
  run a private CA, which is worth trusting explicitly rather than turning
  verification off. An explicit bundle path wins over the checkbox: set one and
  the certificate is verified against it whichever way the box was left.
- **Max Response Size (MB)**: default 10, enforced while the response body is
  still arriving rather than measured after it has all been read, so an
  oversized answer is abandoned mid-stream instead of after the memory has
  gone.
- **Max Records**: default 10000. It is not a row limit. See below.

A query against this data source is a JSON resource selector, the same pattern
the other transportation connectors use:

```json
{ "resource": "events", "params": { "since": "2026-01-01T00:00:00Z", "limit": 100 } }
```

`resource` is one of `events`, `dms_inventory` or `dms_status`. `events` and
`dms_status` accept `since` and `limit`; `dms_inventory` accepts `limit` only.

### `since` and `limit` are applied after the center's response arrives

Both are applied to the decoded records on this side, not sent to the center.
No request type in the published v3.03d schema carries a result count or an
updated-since filter, and the one element that looks like it might
(`request-times`) has no stated semantics there, so sending one would risk
silently returning the wrong rows.

The practical consequence is worth planning for: a large events feed is
transferred in full every time, however small a `limit` you ask for. These two
params narrow what you read, not what the center sends.

`since` is not available for `dms_inventory`, which decodes to no timestamp
column at all. Passing it there fails the query and says so, rather than being
quietly ignored. An ignored time filter hands back rows from outside the
window you asked for, and nothing in the result says the window was never
applied.

`since` takes an ISO-8601 timestamp, and a value carrying no offset is read as
UTC. It compares against `update_time` for `events` and `last_update` for
`dms_status`. A record whose own timestamp is missing is kept: both fields are
optional in the schema, so a center omitting one is not saying the record is
old, and dropping it would hide a live sign behind a filter meant only to
narrow by time.

### `max_records` fails the query, it does not truncate

`limit` truncates on purpose: ask for 100 rows and you get at most 100.
**Max Records** is the opposite control. It caps how many records the center's
response is allowed to decode to, and exceeding it is an error naming the
count, not a shortened table. That is the whole point of it: a partial answer
should never be mistaken for the complete one. When you hit it, either raise
the cap or narrow the query.

The cap is checked before `since` and `limit` are applied, so setting a `limit`
cannot let an unexpectedly huge response through unremarked.

### Coordinates are converted, and the raw integer is kept beside them

`latitude` and `longitude` come back as decimal degrees, divided by 1,000,000
from the integers the center sent. The published XSD never writes "degree",
"microdegree", or any unit at all on these types. The factor is implied by
their value bounds and nothing else: latitude is bounded at plus or minus
90,000,000 over plus or minus 90 degrees, longitude at plus or minus
180,000,000 over plus or minus 180, and both divide out to 1,000,000 units per
degree.

Because that factor is inferred rather than documented, every coordinate
column has a `_raw` sibling, `latitude_raw` and `longitude_raw`, carrying the
integer exactly as it arrived. If a center turns out to scale differently, the
raw column still holds what it sent and you can do the arithmetic yourself.
`events` and `dms_inventory` carry all four columns. `dms_status` carries no
location.

### Enumerated columns are passed through exactly as sent

`severity`, `status` and `direction` on `events`, `direction` on
`dms_inventory`, and `oper_status` on `dms_status` are enumerated fields, and
the schema lets each of them arrive either as a bounded integer or as a string
token. Whichever form the center sends is the form that lands in the column.
The connector does not translate between the two.

That is deliberate, not an omission. 88 of the 207 named simple types in the
published `TMDD.xsd` are integer-or-string unions, and the schema asserts no
mapping between the two arms anywhere. A matching count invites the assumption
that the first integer means the first string, and one type in the same bundle
disproves it: `Time-reference-code` is a union of 4 integers against 5
strings, so for that type no positional mapping exists to guess at. Any
connector that translated would be inventing a mapping, and would be provably
wrong somewhere.

What the connector does enforce is membership. A value in neither arm is
refused, with an error naming both, rather than passed into a column the
center's own schema would reject. If you want one representation in a report,
map it in the query or the visualization, where the mapping your center
actually uses is a decision you can see and change.

### `current_message` is the center's own string, markup and all

`dms_status.current_message` is returned exactly as the center sent it. The
published XSD types it as an unrestricted string and its documentation says
nothing about the content, so it may contain NTCIP MULTI markup, the tag
language signs use for line breaks, page timing and justification (`[nl]`,
`[np]`, `[pt50o30]`, `[jl3]`). Nothing here strips or interprets it. If a
dashboard needs rendered text, decode it downstream. Note that this differs
from the NTCIP connector above, whose `dms_message` resource polls a sign
directly and returns a raw `message_multi` and a decoded `message_text` beside
each other.

### `message_type_id`, `message_type_version` and `soap_action`

**Message Type ID** and **Message Type Version** are mandatory in an event
request header. Each is an unconstrained `xs:unsignedByte`, so any whole number
from 0 to 255 is schema-valid, and the published XSD and WSDL do not define
what any particular value means. Both default to `1`, which is what gets sent
unless your center documents values of its own, in which case enter them here.
They appear only in the `events` request; the two DMS requests have no such
header.

**SOAPAction Header Value** is empty by default, which sends
`SOAPAction: ""`. All 80 operations in the published WSDL declare the same raw
value, and that value is two apostrophe characters rather than an empty string.
Read as an authoring artifact it means "no action", which is the empty header;
read literally it means the action URI is `''`. The published XSD and WSDL
cannot settle which was meant. So if your center rejects the empty header, put
two apostrophes in this field and that is what will be sent, with no code
change needed to match either reading.
