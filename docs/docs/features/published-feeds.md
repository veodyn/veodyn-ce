---
sidebar_position: 15
title: Published Feeds
description: "Re-publishing a query's results as a standard GTFS-Realtime feed: the binding form, validation, the publish history, and the anonymous address consumers read."
---

# Published Feeds

Every other page in this section is about getting data *out* of the instance in
whatever shape your tool wants. This one is the opposite direction of the same
idea: taking a saved query's results and serving them back out **in a standard
other people's software already speaks**, so a rider app or a downstream agency
can consume them without knowing anything about Veodyn.

Today that standard is **GTFS-Realtime 2.0**. A published feed is a declaration
that one query, mapped one way, is the source of one feed at one address.

It lives at **Connect → Feeds** in the sidebar (`/connect/feeds`), where the page itself is titled Published Feeds.

## Publishing is administered

Reading the list takes nothing more than being signed in. **Creating, editing,
deleting and publishing take an administrator**, and the API enforces that
independently of the interface, with a 403.

A non-admin does not see those controls disabled. They are **absent**, with one
sentence in their place:

> Publishing is administered. An administrator declares what this instance serves.

That is deliberate. A disabled button implies a permission you might acquire by
trying it, and a control that has simply vanished looks like a page that failed
to load. The sentence is what turns an absence into a stated arrangement.

The line falls where it does because a published feed is an anonymous read
surface over query results: creating one changes both what data is exposed and
who can reach it. Setting a [cadence expectation](/features/monitoring) on the
Feed Health board next door is open to any member for exactly the opposite
reason, since it changes neither.

## The list

![The published feeds list: address over source query, standard, access and revision](/img/screenshots/connect-feeds.png)

Four columns, and rows open the feed's own page.

| Column | Holds |
|---|---|
| **Address** | The feed's slug, with the name of the query behind it underneath |
| **Standard** | `GTFS-Realtime 2.0 · vehicle positions` |
| **Access** | Public or Private |
| **Revision** | Which revision of the binding is current |

The Address column carries the source query's name rather than only the slug,
matching how Feed Health prints a feed over its source: a slug answers "what is
this called", and the second line answers "where does its data come from"
without a click.

Search matches the slug, the query name and the visibility.

The empty list and a search that matches nothing say different things (*No feeds
are published yet* against *No published feed matches that search*), the same
distinction the [catalog](/features/data-catalog#when-the-catalog-is-empty-or-unavailable)
draws.

## Declaring a feed

**Publish a feed** opens a form in five parts. Every part is a closed set where
one exists: nothing here is free text that the API will later refuse.

![The Publish a Feed form: source, address, shape, the field-to-column mapping table, and the on-failure modes](/img/screenshots/connect-feed-new.png)

### Source

Pick the saved query whose latest results become the feed. The picker searches
every query you can open.

**Switching the query clears the column mapping.** A field mapped against one
query's columns is meaningless against another's, and carrying it over is how a
form quietly submits a mapping that names columns the new query does not have.
Re-picking the *same* query after pressing **Change** keeps the mapping, so
opening the picker and closing it again costs nothing.

### Address

The **slug** is the feed's address, and half its identity: `vehicles-live`
rather than a number.

**Visibility** is two options:

| | Who can read it |
|---|---|
| **Private** | Only signed-in members of the org |
| **Public** | Anyone with the URL, with no credential |

A **public** slug is claimed across the whole instance rather than within your
org, because a public feed's address carries no org segment. Claiming one that
another tenant already holds is refused with a 409, and the refusal deliberately
does not say who holds it: naming them would turn the message into a
cross-tenant directory. Choose another slug, or keep the feed private.

### Shape

Standard and version are stated as facts (`gtfs-rt`, `2.0`) rather than
one-option dropdowns, because a control with a single choice invites clicking it
to find out what else is there, and there is nothing else.

**Entity** is a fact or a picker depending on what this deployment actually
registered. A community build registers exactly one, `vehicle_positions`, and
shows it as a fact. An [enterprise](/editions) build whose pack registers more
gets a picker over the real list. The form asks the running service what it
holds rather than inferring it from a values file, and if that lookup is slow or
fails it degrades to the single fact rather than to an empty picker.

### Mapping

A **static GTFS reference** (the scheduled feed this realtime feed extends) is
required.

Then the column map: each GTFS field against a column of the query's own result.

| Field | Required |
|---|---|
| `vehicle_id`, `latitude`, `longitude` | Yes |
| `trip_id`, `route_id`, `bearing`, `speed`, `timestamp` | No |

Missing required fields are named on submit and update live as you map them,
rather than freezing on whatever was missing at the first attempt.

**A query that has never run has no columns to offer**, and the mapping table
says exactly that rather than rendering eight dropdowns whose only selectable
value is *Not mapped*. The mapping can still be saved in that state, and the
page says so too, along with the consequence: nothing has checked it.

### On failure

Two modes, and **their names read backwards from what they do at serving time**,
which is worth reading twice before choosing:

- **Block** refuses to *publish* a bad read. The feed keeps serving the last
  artifact that passed, with its original timestamp, for as long as that takes.
  It never stops serving on age alone.
- **Last known good** is the same, **plus a required maximum age**. Past that
  age the address stops answering.

So the tolerant-sounding option is the one that can take a feed dark, because
the operator who picks it also has to say how stale is too stale. The age field
appears only in that mode, because the API refuses a cap on `block` and requires
one on `last_good`.

### What is checked when you save

The binding is validated **before anything is written**, so a refused save
leaves the stored binding and whatever is currently being served exactly as they
were. The query has to exist and be readable, and the column map has to name
columns its results actually have. A map that cannot produce the feed is refused
with every problem named at once, while the person who wrote it is still looking
at it.

## The feed's page

`/connect/feeds/<slug>` is the whole record: what it is bound to, where it can
be read, and every attempt to publish it.

![A feed's page: Serving in the header, the public address, the binding, and a publish history holding a published attempt and a blocked one](/img/screenshots/connect-feed-detail.png)

### Serving status

In the header, one word about whether anything is being served right now.

| Status | Means |
|---|---|
| **Serving** | An attempt published and its bytes are what the address answers with |
| **Not serving** | The newest attempt published, but an edit or a delete has since retired the declaration it answered for |
| **Blocked** | The validator refused the bytes |
| **Failed** | The attempt never reached a verdict at all |
| **Never published** | No attempt has been recorded |

**Not serving is not a failure**, and the distinction matters. That attempt
produced bytes, they passed, and they were served. Then something retired the
binding underneath them. Calling it *Failed* would put one decision on screen as
another, three lines above a history saying *Published* about the same row.

This is serving state, not mapping state. The page will not tell you the binding
is valid on a read, because the check that would establish that is only run on a
write.

### Address

A **public** feed shows its full address with a copy button, and says plainly
that anyone can read it with no credential, once an attempt has published.

A **private** feed shows **no address at all**, and says why: reaching one takes
an issued token, and the token model (issuance, rotation, revocation) is not
built. Printing a URL that refuses everything would send someone looking for a
credential that does not exist yet. An [enterprise](/editions) build mounts its
token panel in that space.

### Binding

The committed declaration, read back: query, standard, version, entity, static
GTFS reference, on-error mode with its cap, visibility, revision, and the full
column map.

### Publish history

Every attempt this instance has recorded, newest first, each with its decision,
the binding revision it ran against, and a marker on the one currently serving.

What renders under an attempt depends on what kind of answer it was:

- A **blocked** attempt lists the validator's **findings**, grouped by rule. The
  attempt's own reason is only a count ("2 conformance error(s)"), so the
  findings are the actual explanation.
- A **failed** attempt has no findings, because nothing ever reached a verdict.
  Its one reason sentence is the whole explanation.
- A **published** attempt lists findings too, when it has any, under *Warnings
  the feed published with*. A feed that published is not a feed with nothing to
  say about itself, and dropping the warnings at the moment of success is how a
  slow drift into non-conformance stays invisible until it becomes an error.

Findings group by rule, with the individual locators behind a disclosure, since
one broken rule arriving as forty rows reads as forty problems.

:::note "showing 40 of 4,000 occurrences"

The validator caps how many occurrences it exports per rule while reporting the
true total separately. Where the two differ the disclosure says so. Printing the
number of rows on screen as though it were the total would tell you forty
vehicles are broken when four thousand are, which is worse than vague because it
looks exact.

:::

### Publish now

An administrator can run a single attempt on demand.

**The button is withheld rather than offered in any state where an attempt
cannot succeed**, with a sentence saying which state that is:

| What is true | What the page says instead of a button |
|---|---|
| The check is still running | *Checking whether this query has a result newer than the one being served.* |
| The query could not be read | *This query could not be read, so there is no telling whether publishing would serve anything new.* |
| The query has no cached result | *This query has no cached result, so there is nothing to publish.* |
| Its newest result is not newer than the serving one | *This query has produced nothing new since the last publish.* |

Each of the four is its own sentence rather than one generic line, because the
page has established different things in each case.

### Editing takes the feed off the air

Saving an edit to a feed that is **currently serving** takes it dark until a new
attempt succeeds. The interface will not let that happen silently:

- The submit button reads **Save and republish** rather than **Save**, but only
  when the feed is actually live. On one that is already dark there is nothing
  to republish and promising it would be a second untruth.
- A confirmation states the consequence: consumers of the address get nothing in
  the meantime.
- Confirming fires the update and then a publish attempt immediately, rather
  than leaving the feed dark until some later cycle.

A refused save keeps every value on screen, so a rejection does not cost you the
mapping you just built.

**A slug cannot be renamed.** It is half the feed's identity; publish a new feed
to change it.

### Deleting

Delete asks for confirmation and says what it means: consumers of that address
start getting nothing, a deleted slug is indistinguishable from one that never
existed, and it cannot be undone.

## How a consumer reads a public feed

`GET /api/public/feeds/<slug>` returns raw GTFS-Realtime bytes as
`application/x-protobuf`. It is the one route in the sidecar's community surface
that takes no credential at all, on the grounds that most software that speaks
the format will never hold one.

**Everything it refuses answers the same 404, with the same body.** An unknown
slug, a slug naming a private feed, and a slug that has never published a clean
attempt are deliberately indistinguishable. Telling them apart would rebuild the
probing oracle that a single 404 exists to close, letting a caller learn which
slugs are taken, or merely dark, one guess at a time.

The one exception is staleness, and only under **last known good**. Past the
configured cap the endpoint answers **503 with a `Retry-After`** carrying that
cap, rather than serving stale bytes.

Two details of that are worth knowing if you consume one:

- **`Retry-After` is the feed's own age cap, not a prediction.** The endpoint
  cannot know when the next publish lands. The cap is the only interval anybody
  has actually stated about this feed's tolerable staleness, so it is the one
  honest number available.
- **Age is measured from the artifact's own header timestamp**, not from when
  the attempt was recorded. That is what the served bytes tell a consumer the
  data's time is. Measuring our own pipeline instead would call a fresh publish
  of hours-old rows current.

Under **block**, there is no staleness branch at all. That is not an omission:
`block` is about refusing to publish a bad read, which the engine already did
before those bytes ever became current.

## What community ships, and what it does not

:::caution A deployment with no validator configured publishes nothing

Validation is an external service (the containerized MobilityData GTFS-Realtime
validator), named by `VEODYN_FEED_VALIDATOR_URL`. **Leave it unset and every
publish attempt fails closed**, recorded as a `failed` attempt rather than
publishing bytes nothing checked.

That is the intended behaviour, not a misconfiguration to work around: an empty
finding list from a validator that never answered is indistinguishable from a
clean feed. See [Configuration](/configuration#sidecar-api).

:::

| | Community | Enterprise |
|---|:---:|:---:|
| Declaring, editing and deleting a feed | ● | ● |
| Publishing on demand, and the attempt history | ● | ● |
| Serving a public feed anonymously | ● | ● |
| `vehicle_positions` | ● | ● |
| Further entity types (trip updates, service alerts) | | ● |
| A worker that publishes on a schedule | | ● |
| Tokens for reading a private feed | | ● |
| Attribution for a blocked attempt | | ● |

A community build therefore publishes when an administrator presses the button,
and an enterprise one also publishes on a cadence of its own.

**A downgrade fails closed rather than reinterpreting anything.** A feed bound
to an entity the current build no longer registers goes on showing the entity it
was actually bound to, rather than a value invented from today's registry.

## Ordering, and why nothing here reports a mapping fault as a data fault

Serialization runs **before** validation, always. Hand the validator bytes built
from a column mapped to the wrong thing and it answers with whatever conformance
rule that happens to trip: a trip id that does not exist, a position outside the
agency's bounding box. The operator then goes looking in the schedule for a
fault that lives in the binding.

Building the bytes first means a mapping defect is named as a mapping defect,
and a verdict only ever means something about bytes that exist.

Only a clean verdict moves the pointer. On any other decision the address keeps
serving the last artifact that did pass.
