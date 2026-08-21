---
sidebar_position: 12
title: Read a DMS fleet over NTCIP 1203
description: "Polling dynamic message signs over SNMP: the device list, the three resources, why an unreachable sign is a row rather than a failed query, and the network rule that comes with SNMP v1 and v2c."
---

# Read a DMS fleet over NTCIP 1203

Dynamic message signs are the part of the network the public actually reads.
Knowing what every sign is displaying right now, and which ones are not
answering, is a board worth having. This polls them directly over SNMP, per
NTCIP 1203, without going through a traffic management center.

If your signs are behind a center that speaks TMDD, read [Put a traffic
management center on your board](/use-cases/tmc-events-and-signs) instead. That
path gives you the center's own view, over the network path the center already
allows.

## What has to be true

:::caution SNMP v1 and v2c send the community string in clear text

Point this connector only at a network path you control. Never across the open
internet.

That is not a preference. The read community is the whole credential, and both
protocol versions put it on the wire unencrypted.

:::

Beyond that: the signs answer SNMP on a reachable address, and you know their
read community string. A typical default is `public`, and any deployment worth
polling has changed it.

## Before you start

Collect the fleet as a list of hosts with names you will recognize on a
dashboard. The `name` is what a query selects by; it does not have to match
anything on the device.

```json
[
  { "name": "I-5 NB MP12", "host": "10.0.1.20", "port": 161 },
  { "name": "I-5 SB MP12", "host": "10.0.1.21" },
  { "name": "US-101 NB MP4", "host": "10.0.2.5", "port": 1610 }
]
```

`port` defaults to `161` when omitted, as in the second entry.

## The steps

### 1. Add the data source

**Admin → Data Sources → New Data Source**, type NTCIP 1203 DMS. The device list
above goes in the **Devices (JSON)** field. The rest:

| Field | What to set |
|---|---|
| **SNMP Community String** | The read community configured on the signs. Stored encrypted |
| **SNMP Version** | `2c` unless the signs only answer to `1` |
| **Per-Device Timeout** | Seconds allowed for one sign's SNMP transaction before moving on. Default 2 |
| **Max Devices Polled** | A fleet-size cap applied after any device selection, so a query against "all devices" cannot poll more than this. Default 50 |

### 2. Write the queries

A query is a JSON resource selector:

```json
{ "resource": "dms_status", "params": { "devices": ["I-5 NB MP12"] } }
```

Omitting `params.devices` polls every configured device, subject to the
max-devices cap. Three resources:

| Resource | Answers | Useful columns |
|---|---|---|
| `dms_identity` | What this sign is | `sys_name`, `sign_type`, `width_px`, `height_px` |
| `dms_status` | How it is doing | `door_open`, `error_status`, `brightness_level` |
| `dms_message` | What it is displaying | `message_multi`, `message_text`, `message_source` |

`dms_message` is the one that earns the dashboard. It hands you the raw MULTI
string and a decoded plain-text rendering of the same message, side by side, so
you can show operators the text and still keep what the sign actually holds.

Status columns arrive decoded with the raw integer kept beside them
(`error_status` and `error_status_raw`, `door_open` and `door_open_raw`), which
is what you want the first time a sign reports something the decoder has no name
for.

### 3. Read `poll_status` before you read anything else

Every row carries a `poll_status` of `healthy`, `error` or `skipped`, so one
unreachable sign in a fleet of fifty does not fail the whole query. It shows up
as one row saying so.

The two failure values mean different things and lead to different fixes:

| Value | Means | What to do |
|---|---|---|
| `error` | This sign was reached and something went wrong with it | Look at the sign, or at the `error` column |
| `skipped` | This sign was never attempted at all, because the whole-query deadline ran out before its turn | Raise `request_timeout` (capped at 30 seconds) or poll fewer devices per query |

A board that counts `error` and `skipped` together will send a technician to a
sign that was never called.

### 4. Build the board

- A table of current messages: `device`, `message_text`, `message_source`,
  filtered to `poll_status = 'healthy'`.
- A counter of signs not answering, split by `poll_status` so the two categories
  stay apart.
- A table of signs in a fault state, from `dms_status` where `error_status` is
  anything but normal, or `door_open` is true.

Put a [refresh schedule](/features/queries#the-query-actions-menu) on each, and
size it against your fleet: fifty signs at a two second timeout is a poll that
can take a while when several are down, and the whole-query deadline is 30
seconds.

If the fleet is large, split it into several queries by corridor rather than
raising the caps. A per-corridor query that finishes is worth more than a
fleet-wide one that spends its deadline on the first ten signs and marks the
rest `skipped`.

Org-wide, whether those schedules are keeping up is on
[Schedules](/features/schedules) rather than on each query's own page.

### 5. Capture the polls, so uptime becomes a number

Every board above reads the current poll. Sign uptime is the question that needs
the previous thousand, and historical capture is offered on this source type like
any other: switch it on, keep the queries scheduled, and `poll_status` per sign
per poll accumulates.

```sql
SELECT device,
       countIf(poll_status = 'healthy')                     AS answered,
       countIf(poll_status != 'skipped')                    AS attempted,
       round(100.0 * countIf(poll_status = 'healthy')
             / nullif(countIf(poll_status != 'skipped'), 0), 1) AS uptime_pct
FROM historical.q_dms_status_31
WHERE captured_at >= now() - INTERVAL 30 DAY
GROUP BY device
ORDER BY uptime_pct
```

The denominator is attempts, not polls, which is why `skipped` is filtered out of
it. A sign never reached says nothing about whether it was up, and counting those
against it produces an uptime figure that falls when your own query gets slower.

## How you know it worked

`dms_message` returns the text an operator standing in front of the sign can
read back to you, and the count of `healthy` rows matches the number of signs
you believe are up.

## What this does not do

It does not write to signs. There is no message posting, no scheduling and no
control of any kind here: this reads identity, status and the current message,
and that is the whole surface.
