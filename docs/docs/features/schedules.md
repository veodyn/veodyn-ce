---
sidebar_position: 16
title: Schedules
description: "Every query with a refresh schedule, and whether it is keeping up."
---

# Schedules

Every query that runs on its own, and whether it is keeping up. [Captures](/features/captures) is not a strict subset of this page, even though every capture is also a query: Captures keeps any dataset it has captured before, whatever its query's schedule looks like now, while this page lists every query with a schedule interval set, expired schedules included (they show a State of Expired rather than disappearing). A capture whose query lost its interval entirely stays on Captures and drops off here; a scheduled query that writes nowhere in the warehouse shows up here and never there.

`/schedules` lists every query that runs on its own and whether it is keeping up: the query, how often it runs, a state (On time / Late / Expired), its last result, and the owner. Search by query or owner; every column sorts. It is the org-wide view of the schedules users attach to their [queries](/features/queries#the-query-actions-menu).

**Last result** here is the same field, with the same wording, as on the [query's own page](/features/queries#the-two-ages-and-why-there-are-two): when the rows were last fetched, not when the query was last edited. The two screens report one number for one thing.

The list reads far past a first page, up to 2,000 queries across 20 pages of 100, rather than the default 25 the list endpoint returns. Past that cap the page says so, in a line above the table, instead of quietly dropping the rest.

![The Schedules page listing every scheduled query and its punctuality](/img/screenshots/schedules.png)

Deeper, admin-only views of the same machinery (worker queues, outdated queries, backend status) live under [System Administration](/admin/system).
