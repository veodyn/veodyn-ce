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

The setup below produces them once, from the systems of record, into a single
board and a table you can read the filing off.

:::caution Veodyn does not count passengers

Every number here comes from a system that counts: your APC, farebox, dispatch
or scheduling system. Nothing in this product produces a ridership figure, so a
number that arrives wrong will appear on the board wrong. What the pack adds is
one place to keep them, one definition per measure, and a reconciliation step.

Note also that FTA must approve an agency's automatic passenger counters before
their data may be used for NTD reporting, and that approval is about the
counting equipment and its validation, not about how the numbers are later
assembled. Read the current [NTD reporting policy
manual](https://www.transit.dot.gov/ntd) for your reporter type.

:::

## What has to be true

Each measure needs exactly one system of record, and you have to be able to say
which one it is. If two systems both produce VRM and they disagree, sorting
that out is the real work; putting both on a dashboard will not settle it.

| Measure | Usually comes from |
|---|---|
| UPT, unlinked passenger trips | APC, farebox, or a manual count program |
| VRM, vehicle revenue miles | Scheduling or CAD, revenue service only |
| VRH, vehicle revenue hours | Scheduling or CAD, revenue service only |
| VOMS, vehicles operated in maximum service | Dispatch, at the peak |

Most reconciliation errors turn out to involve revenue service. Deadhead miles
do not count as revenue miles, and a mileage figure taken off the odometer
includes them.

## Before you start

- A [data source](/admin/data-sources) for each system of record.
- Your mode and type-of-service coding as the agency files it, which can differ
  from how a vendor's schema spells it.
- Last year's filed numbers, for step 4.

## The steps

### 1. Write one query per measure, not one query per report

Each measure gets a query returning the same shape: month, mode, type of
service, value. Keeping that shape identical is what lets you compose them in
step 2.

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
which flag decides revenue service. If shuttles were left out, the description
is where a reader finds that out.

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

Use a `LEFT JOIN` here. An inner join silently drops a month where one system
was late, and a missing row is something you want to be able to see.

### 3. Build the board

![A dashboard in view mode with charts, a counter, and a text box](/img/screenshots/dashboard-view.png)

- Counters for the current month's UPT, VRM, VRH, each with the prior year's
  same month as the comparison.
- A line chart of UPT by month, one series per mode.
- A pivot table, month against mode, value UPT. Most people copy their numbers
  out of this one.
- The combined table from step 2, which the filing is read off.
- A choropleth, if the board asks where the service went as well as how much of
  it there was. [Build a service equity board](/use-cases/service-equity)
  assigns stops to your own tract or district boundaries, and the by-mode pack
  gives you a value to shade those regions with.

Schedule the queries monthly, a few days after your data is closed rather than
on the first. A refresh that lands in a half-closed month shows incomplete
numbers.

### 4. Reconcile before anyone relies on it

Run the pack against a period you have already filed and compare it line by
line. Most differences come from definitions rather than from a broken query,
and each one has a cause worth writing down: deadhead in the mileage, a mode
coded differently in the vendor's schema, or a manual adjustment made in a
spreadsheet that nothing else knows about.

The first two are fixable in the query. A spreadsheet adjustment has to be
changed in the process itself, which the board at least makes visible.

### 5. Keep the evidence

If any query here reads a table with a retention policy, or a
[captured](/use-cases/history-capture) table with a TTL, the numbers behind a
filed report can expire. Export the month's table when you file, and keep it
where your filings are kept.

Historical capture gives you a second copy, and it is worth setting up even if
you also export. It is offered on every source type, including the SQL
databases your systems of record live in, so a monthly capture of the measure
queries leaves the filed month's supporting rows in the warehouse under a
`captured_at` you can point at. Set that capture's retention to `0` if it is
holding evidence, since a TTL would eventually delete the rows behind the
filing.

## How you know it worked

The pack reproduces a filed month to the row, or every difference has a named
cause. Do this once, before anything is published off the pack.

## What this does not do

It does not file anything. There is no NTD submission step here, and no upload
or form. The pack produces the numbers and the evidence behind them; someone
still has to enter them into the reporting system.

It also covers only the half of an NTD report that comes from counting.
Route, trip and service-day figures come off your published schedule instead,
and have their own guide: [Derive NTD service data from your GTFS
archive](/use-cases/ntd-service-data).

It does not certify your counting equipment or run the validation programs that
certification involves. That work happens on the vehicle and in the sampling
plan, before any of it reaches this page.
