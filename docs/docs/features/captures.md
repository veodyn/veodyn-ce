---
sidebar_position: 10
title: Captures
description: "The board of scheduled queries that write into the warehouse, and whether each one delivered on time."
---

# Captures

:::info Looking for Schedules?
It moved to its own page: [Schedules](/features/schedules).
:::

A capture is a scheduled query that writes its results into the historical warehouse, and this page answers the operational question "is the data current", for everyone rather than only admins. `/captures` lists every capture in the instance and whether it delivered on time. When a chart looks stale, this page says whether the capture behind it kept up. Search by capture name or connection; every column sorts except Datasets and Metrics affected.

![Captures: per-capture status, last received, cadence, and datasets](/img/screenshots/captures.png)

| Column | What it holds |
|---|---|
| **Capture** | The capture's name, with the Redash connection it reads underneath |
| **Status** | Fresh, Stale or Down, and how that verdict was reached |
| **Last received** | When data last arrived |
| **Cadence** | How often it is expected, plus a control to set that expectation |
| **Datasets** | The [catalog datasets](/features/data-catalog) this capture populates, each a link |
| **Metrics affected** | The [KPIs](/features/kpis) that read those datasets, or *None* when nothing depends on it. [Enterprise](/editions): a community build has no metrics feature registered, so this column does not appear at all |

## Read the line under the status

A status can be reached two ways, and the page tells you which:

- **Derived**: computed as Stale past twice the cadence and Down past ten times it, but never better than the status the catalog already reported: if the catalog already calls a capture stale, it shows Stale immediately, whatever the multiple says. The cadence comes from an expectation someone declared, marked *expected*, or, failing that, from the capture query's own Redash schedule.
- ***as reported***, printed under the status when neither a declared expectation nor a schedule interval exists to derive a cadence from. What shows instead is the catalog's own freshness check: whether the last capture landed inside the instance's configured stale-after window, with no per-capture multiplier applied. The Cadence column then reads **None declared, so age is not checked**.

That distinction is the page's most useful detail. A capture with neither a declared expectation nor a schedule cannot be judged late against its own cadence, however long it has been silent, so a green *Fresh* marked *as reported* reflects the catalog's blanket cutoff rather than a verdict specific to that capture. Set an expected interval on such a capture and the status becomes something the product can check for you.

## Metrics affected is the blast radius (enterprise) {#metrics-affected-is-the-blast-radius}

This column answers the question a stale capture actually raises: what breaks. It traces the capture to its datasets and on to the KPIs computed from them, so a capture that has been silent for eleven days will name the metrics quietly reading old numbers, or say *None* when nothing depends on it.

Metrics are [enterprise](/editions). On a community build, no feature registers
this column, so it does not appear on the page at all, rather than rendering
every row as *None* and implying nothing depends on the capture. The rest of
the page, including the verdict and the cadence expectation, is community.
