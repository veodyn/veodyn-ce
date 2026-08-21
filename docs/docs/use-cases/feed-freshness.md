---
sidebar_position: 10
title: Prove your captures are current
description: "Turning freshness from something a source claims about itself into a verdict the product reaches: declared cadences, the two ways a status is arrived at, and the schedules behind them."
---

# Prove your captures are current

Every dashboard in the building is downstream of a handful of captures, and the
question that gets asked in the room is always the same one: is this number
current, or has something been quietly dead since Thursday. This is how you make
that answerable without opening a query.

A capture is a saved query that writes its results into the historical
warehouse. [Build a history you can trend](/use-cases/history-capture) is how one
comes into existence; this page is about reading the board of them afterwards.

## What has to be true

A capture can only be judged late if something has said how often it is
expected. Until then, the most the product can do is repeat the catalog's own
blanket freshness check, and a green status on that basis is a cutoff applied to
everything rather than a verdict about this capture.

So the work here is small and mostly one-time: declare a cadence for every
capture that matters, and then treat the board as the thing you look at first.

## Before you start

Nothing but an account. Setting a cadence expectation is open to any signed-in
member, since it changes neither what data is exposed nor who can reach it. That
is the opposite of [publishing a
feed](/features/published-feeds#publishing-is-administered), which is admin-only
because it changes both.

## The steps

### 1. Read the line under the status

Open **Monitor → Captures** (`/captures`). Every row carries a status, and the
page tells you how that status was reached.

| What you see | What it means |
|---|---|
| A status marked *Derived*, with the Cadence column showing an interval | The product compared last-received against a cadence it knows. This is a verdict |
| A status marked *as reported*, with *None declared, so age is not checked* in the Cadence column | The catalog's blanket stale-after window, with no per-capture multiplier. Nothing specific to this capture has been checked |

A derived status has two possible cadences behind it, and the column says which:
an expectation somebody declared, marked *expected*, or failing that the capture
query's own refresh schedule. Either one is enough for the product to reach a
verdict. Neither one, and it cannot.

The rule it applies is worth knowing before you set anything: Stale once the
last arrival is past twice the cadence, Down past ten times it, and never better
than the verdict the catalog already reached. A capture the catalog already calls
stale shows Stale straight away, whatever the multiple would have said.

![Captures: per-capture status, last received, cadence, and datasets](/img/screenshots/captures.png)

### 2. Declare a cadence on every capture you would act on

The Cadence column carries the control. Set the interval to what the source
actually delivers, not to what you wish it did: an interval tighter than reality
turns the board into a wall of red that people learn to ignore, which costs you
the one real alert when it comes. Remember the multiples, too. A cadence of five
minutes reads Stale at ten and Down at fifty.

Work down the list in the order the rows matter to you. A capture nothing depends
on can stay undeclared, and the board will say so honestly.

### 3. Know what breaks when one goes silent

The **Datasets** column names the [catalog datasets](/features/data-catalog)
each capture populates, each a link. That is the blast radius in community terms:
these tables stop moving.

On an [enterprise](/editions) build there is a **Metrics affected** column beside
it, tracing those datasets on to the KPIs computed from them. A community build
registers no metrics feature, so the column is not on the page at all. That is
worth knowing before you go looking for it: an absent column is the honest
rendering, where a column reading *None* on every row would be a claim that
nothing depends on any of these captures.

### 4. Check the schedules, not just the captures

Data can be arriving perfectly while the query that reads it stopped running.
**Monitor → Schedules** (`/schedules`) lists every query with a refresh interval
set, how often it runs, and whether it is keeping up: *On time*, *Late* or
*Expired*. An expired schedule shows as Expired rather than dropping off the
list, which is the state that otherwise disappears silently.

The two pages overlap without either containing the other. Captures keeps a
dataset it has captured before whatever its query's schedule looks like now, so
a capture whose query lost its interval stays there and vanishes from Schedules.
A scheduled query that writes nowhere in the warehouse is the reverse: on
Schedules, never on Captures.

**Last result** on Schedules means when the rows were last fetched, not when the
query was last edited. It is the same field, with the same wording, on the
query's own page.

The list reads up to 2,000 queries across 20 pages of 100. Past that it says so
in a line above the table instead of quietly dropping the rest, which matters on
an instance large enough that the query you are hunting for might be past the
cap.

:::caution Archiving a query silently stops it

Archiving deletes every alert on the query, clears its refresh schedule, and
deletes every dashboard widget built on its visualizations. **Restore** brings
back only the query. A restored query looks entirely intact and has quietly
stopped running, which usually surfaces a week later as a stale number on a
dashboard.

:::

### 5. Tie it to what you publish

If you [publish a feed](/use-cases/publish-gtfs-realtime) of your own, freshness
has a second half. Under `block`, a published feed goes on serving its last good
artifact indefinitely, so an upstream that died is invisible at the published
address. Under `last known good` the address stops answering once the artifact
passes its cap, which is loud but only tells the consumer, not you.

This page is not automatically where you find that out, and it is worth being
exact about why. Publishing reads the bound query's newest cached result and
writes nothing to the warehouse, while this board lists warehouse datasets. So a
published feed's source query appears here only if its data source has
[capture](/use-cases/history-capture) switched on and has captured at least once.
Where it does not, the two surfaces that do answer are
[Schedules](/features/schedules), which says whether the bound query is still
running to its interval, and the feed's own publish history, where a run
producing nothing new is what a stalled upstream looks like from the publish
side.

Switching capture on for the bound query's source is the way to put a published
feed on this board deliberately, and it is worth doing for the feeds you would be
called about.

A private feed is quieter still. A consumer whose token has been revoked or has
expired gets the same 404 an unknown slug gets, not a 503, so from outside there
is no way to tell a dead credential from a feed that was never there. Only a
token that has already resolved ever reaches the staleness answer. Whoever is
reading a private feed of yours needs a name and a person to write to, because
the endpoint will not tell them anything.

Either way, the published feed's page tells you what was served, and it cannot
tell you whether the data behind it is still arriving. That second question is
this board's, once the capture exists for it to answer from, and Schedules' until
then.

## How you know it worked

Open Captures and count the rows still marked *as reported*. If the answer is
zero for every capture anyone would act on, the board is now a check rather than
a summary of claims.

## What this does not do

It does not page anyone. The [alerts](/features/alerts) surface is
[enterprise](/editions), and Captures is a board you look at, not a notification
you receive. Deeper admin-only views of the same machinery, worker queues,
outdated queries and backend status, live under [System
Administration](/admin/system).
