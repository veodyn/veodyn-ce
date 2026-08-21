---
slug: /use-cases
sidebar_position: 1
title: Use Cases
description: "Goal-first guides: publishing a feed a consumer will accept, meeting a reporting requirement, bringing an outside system onto your own board, and analysing what you have accumulated."
---

# Use cases

The rest of this documentation is organized by surface: here is the query
editor, here is the feed page, here is what each field does. These guides go the
other way. Each one takes a single goal an agency actually has, and walks it from
the data you already hold to the thing somebody else can read.

Eighteen guides sit here, in five groups. Nearly all of them are written to the
same five parts, in the same order:

| Part | What it holds |
|---|---|
| What has to be true | The requirement, stated as the consumer or the regulator states it, not as the product states it |
| Before you start | What must already exist. Usually a query that has run at least once, and a credential |
| The steps | The path, in order, naming the page each one happens on |
| How you know it worked | The check that settles it, run from outside the instance wherever one exists |
| What takes it off the air | The failure modes, so the first one you hit is one you have already read about |

The short ones collapse that to steps and honest limits, which is the same
contract with nothing in the middle worth a heading of its own.

The guides come in two kinds. Some drive a product feature end to end, and every
step is a page in this documentation. Others are recipes over data that is
yours: the product's part is the ingest, the schedule, the query and the board,
and the numbers' credibility comes from your own systems. Each guide says which
it is, and what it will not do for you.

Unless a step says otherwise, everything described is in the community edition.
Steps that need the [enterprise edition](/editions) say so where they appear,
and where a capability is split down the middle the guide states which half
falls where: reading a private feed is community, issuing the token it is read
with is enterprise; ingesting trip updates and service alerts is community,
publishing them is enterprise.

## Publishing a feed

| Guide | What you end up with |
|---|---|
| [Publish a GTFS-Realtime feed](/use-cases/publish-gtfs-realtime) | Vehicle positions at a public address, in protobuf, validated before every publish |
| [Publish a GBFS feed](/use-cases/publish-gbfs) | A whole GBFS system, docked or free-floating, at an address a city permit or an aggregator can be pointed at |
| [Query a static GTFS archive](/use-cases/static-gtfs-archive) | The schedule tables behind both of those, queryable beside the realtime feeds and checkable before anything depends on them |
| [Take a feed back from a vendor](/use-cases/take-back-a-vendor-feed) | The same feed served from your own node, proven equivalent before anyone is asked to move |

## Reporting and evidence

| Guide | What you end up with |
|---|---|
| [Assemble a monthly ridership pack](/use-cases/ridership-reporting) | UPT, VRM, VRH and VOMS by mode and type of service, from the systems of record, reconciled against a month you have already filed |
| [Derive NTD service data from your GTFS archive](/use-cases/ntd-service-data) | Route, trip and service-day counts read off the schedule you already publish, with the archive checked first |
| [Report on demand-response service](/use-cases/demand-response) | Denials, missed trips, untimely pickups and ride length out of the dispatch system, on definitions written down once |
| [Build a service equity board](/use-cases/service-equity) | Stops and service assigned to your own tract or district boundaries, shaded on a map, on attributes you bring |
| [Prove your captures are current](/use-cases/feed-freshness) | A declared cadence on every capture, so freshness is a verdict the product reaches rather than a claim the data makes about itself |

## Operating pictures

| Guide | What you end up with |
|---|---|
| [Put a traffic management center on your board](/use-cases/tmc-events-and-signs) | Active events and sign status from a TMDD center, on dashboards of your own |
| [Read a DMS fleet over NTCIP 1203](/use-cases/dms-ntcip) | Every sign's identity, status and current message, with unreachable signs visible as rows rather than as a failed query |
| [Build an incident and air quality picture](/use-cases/incident-and-air-quality) | Traffic alerts, air quality and weather on one auto-refreshing grid, with a reliability floor that keeps the noise out |

## Analysis over time

| Guide | What you end up with |
|---|---|
| [Build a history you can trend](/use-cases/history-capture) | Query results accumulating into a warehouse table, which is what every recipe below is built on |
| [On-time performance](/use-cases/on-time-performance) | OTP% by route and day, computed from the delays your own trip-update feed reports |
| [Track fleet utilization from telematics](/use-cases/fleet-utilization) | Vehicles in service by hour, and the list of vehicles that have not moved in a week |

## Getting data back out

| Guide | What you end up with |
|---|---|
| [Ask your data from an AI client](/use-cases/ask-your-data-mcp) | Claude Desktop or an IDE reading your instance over MCP, read-only, scoped to your own permissions |
| [Publish an open-data page](/use-cases/open-data-page) | A dashboard the public reads without an account, and an embed that survives being pasted into somebody else's site |
| [Distribute a feed to a named partner](/use-cases/feed-to-a-partner) | One consumer reading a private feed on a credential you issued them and can revoke on its own |

## What these guides do not do

They do not author your schedules, your fares or your service, and they do not
count passengers. Veodyn moves, normalizes, stores, draws and republishes data
that some other system is the source of. Where a guide's real answer is "fix it
upstream", it says so instead of routing you through a workaround that hides the
defect one layer down.
