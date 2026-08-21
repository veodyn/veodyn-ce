---
sidebar_position: 6
title: Assemble a monthly ridership pack
description: "Pulling UPT, VRM, VRH and VOMS out of the systems that count them into one monthly board and one table, with the reconciliation step that keeps the board and the filing in agreement."
---

# Assemble a monthly ridership pack

FTA collects monthly service data from full urban reporters: unlinked passenger
trips, vehicle revenue miles, vehicle revenue hours, and vehicles operated in
maximum service, by mode and type of service. Most agencies produce those
numbers once a month, by hand, out of three or four systems, and then produce
them again for the board in a different shape.

This assembles them once, from the systems of record, into a board anyone can
open and a table you can read your filing off.

:::caution Veodyn does not count passengers

Every number here comes from a system that counts: your APC, farebox, dispatch
or scheduling system. Nothing in this product produces a ridership figure, and a
number arriving here wrong arrives on the board wrong. What this adds is one
place, one definition per measure, and a check.

Note also that FTA must approve an agency's automatic passenger counters before
their data may be used for NTD reporting, and that approval is about the
counting equipment and its validation, not about how the numbers are later
assembled. Read the current [NTD reporting policy
manual](https://www.transit.dot.gov/ntd) for your reporter type.

:::

## What has to be true

Each measure has exactly one system of record, and you can name it without
hedging. If two systems both produce VRM and they disagree, that disagreement is
the actual project, and putting both on a dashboard will not settle it.

| Measure | Usually comes from |
|---|---|
| UPT, unlinked passenger trips | APC, farebox, or a manual count program |
| VRM, vehicle revenue miles | Scheduling or CAD, revenue service only |
| VRH, vehicle revenue hours | Scheduling or CAD, revenue service only |
| VOMS, vehicles operated in maximum service | Dispatch, at the peak |

Revenue service is where most reconciliation errors live. Deadhead miles are not
revenue miles, and a mileage figure that comes off the odometer includes them.

## Before you start

- A [data source](/admin/data-sources) for each system of record.
- Your mode and type-of-service coding, as the agency files it. Not as a
  vendor's schema happens to spell it.
- Last year's filed numbers, for step 4.

## The steps

### 1. Write one query per measure, not one query per report

Each measure gets a query returning the same shape: month, mode, type of
service, value. That is what makes them composable later.

```sql
SELECT
  date_trunc('month', service_date)  AS month,
  mode_code                          AS mode,
  tos_code                           AS tos,
  sum(boardings)                     AS upt
FROM apc_daily_totals
WHERE service_date >= date_trunc('month', now()) - INTERVAL '13 months'
  AND revenue_service
GROUP BY month, mode, tos
ORDER BY month, mode, tos
```

Thirteen months rather than twelve, so every chart can show the same month last
year without a second query.

Name each query for the measure and the source, `UPT from APC daily totals`, and
put the definition in the query description: what is included, what is excluded,
which flag decides revenue service. That description is the only place anyone
will find out that shuttles were dropped.

### 2. Combine them into one table

With the four queries saved, a `results` data source composes them without
copying any SQL:

```sql
SELECT u.month, u.mode, u.tos,
       u.upt,
       m.vrm,
       h.vrh,
       round(u.upt / nullif(h.vrh, 0), 2) AS trips_per_revenue_hour
FROM cached_query_31 AS u
LEFT JOIN cached_query_32 AS m ON m.month = u.month AND m.mode = u.mode AND m.tos = u.tos
LEFT JOIN cached_query_33 AS h ON h.month = u.month AND h.mode = u.mode AND h.tos = u.tos
ORDER BY u.month DESC, u.mode
```

The `LEFT JOIN` matters. An inner join silently drops a month where one system
was late, and a missing row is exactly what you want to see.

### 3. Build the board

- Counters for the current month's UPT, VRM, VRH, each with the prior year's
  same month as the comparison.
- A line chart of UPT by month, one series per mode.
- A pivot table, month against mode, value UPT. This is the shape most people
  want to copy out of.
- The combined table from step 2, which is what you read the filing off.
- A choropleth, if the board asks where the service went as well as how much of
  it there was. [Build a service equity board](/use-cases/service-equity)
  assigns stops to your own tract or district boundaries; a by-mode pack is the
  obvious thing to shade those regions with.

Schedule the queries monthly, a few days after your data is closed, not on the
first. A dashboard that refreshes into a half-closed month teaches people to
distrust it.

### 4. Reconcile before anyone relies on it

Run the pack against a period you have already filed and compare, line by line.
Differences are not failures, they are definitions surfacing, and each one has a
cause worth writing down: deadhead in the mileage, a mode coded differently in
the vendor's schema, a manual adjustment made in a spreadsheet that nothing else
knows about.

Two of those are fixable in the query. The third is a process to move, and the
board is now the place to have that argument.

### 5. Keep the evidence

If any query here reads a table with a retention policy, or a
[captured](/use-cases/history-capture) table with a TTL, the numbers behind a
filed report can expire. Export the month's table when you file, and keep it
where your filings are kept.

There is a second way to pin them, and it is worth knowing about even if you
still export. Historical capture is offered on every source type, the SQL
databases your systems of record live in included, so a monthly capture of the
measure queries themselves leaves the filed month's supporting rows sitting in
the warehouse under a `captured_at` you can point at. Give that capture a
retention of `0` if it is doing evidence duty. A TTL on the table that holds a
filing's backup is the one place retention actively costs you something.

## How you know it worked

The pack reproduces a filed month to the row, or every difference has a named
cause. Nothing else counts as verification, and doing it once at the start is
worth more than every check afterwards.

## What this does not do

It does not file anything. There is no NTD submission here: no upload, no
transmission, no form. The pack produces the numbers and the evidence for them,
and a person still enters them where they are entered.

It also covers only the half of an NTD report that comes from counting.
Route, trip and service-day figures come off your published schedule instead,
and are their own guide: [Derive NTD service data from your GTFS
archive](/use-cases/ntd-service-data).

It also does not certify your counting equipment, or perform the validation
programs that certification involves. That work happens on the vehicle and in
the sampling plan, upstream of everything on this page.
