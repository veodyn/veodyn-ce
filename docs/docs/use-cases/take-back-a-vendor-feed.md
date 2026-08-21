---
sidebar_position: 5
title: Take a feed back from a vendor
description: "Moving a public feed from a vendor's address to your own: where the data has to come from, how to prove the two are equivalent, and how to run both until consumers have moved."
---

# Take a feed back from a vendor

A vendor publishes your realtime feed at their address. Riders' apps, the
regional 511, and an aggregator or two read it there. You want it served from
infrastructure you control, without a day where nobody gets anything.

This is a migration, not a feature. The product half of it is small; the part
that takes planning is the consumers.

## What has to be true

The data has to come from your side of the boundary. A published feed is
built from a saved query's results, so the question is what that query reads.

| Where your positions live | What to do |
|---|---|
| An AVL, CAD or ITS database you own | Add it as a [data source](/admin/data-sources) and query it. This is the case that actually ends the dependency |
| A GTFS-Realtime websocket stream you can subscribe to | The [`gtfs_realtime` connector](/connectors) samples it and returns a snapshot, one row per vehicle |
| Only the vendor's public protobuf URL | The same connector reads that shape too: point its Feed URL at the `http(s)://` endpoint and each run decodes one snapshot |

The third row used to be a dead end and is not one any more, which makes it
worth being precise about instead of blunt. The ingest works. What it does not
do is end the dependency: republishing a vendor's HTTP feed through your own
address moves the URL and leaves the supply where it was. If their feed stops,
yours stops on the next run, and now it is your address that is dark and your
phone that rings.

That is still a real step, and often the right first one. Standing your address
up in front of the vendor's data lets consumers migrate while the data path is
unchanged, so the cutover to your own AVL system later is a change nobody
outside has to hear about. Treat it as the first of two moves rather than the
whole migration.

You cannot redirect their URL. Nothing here can make the vendor's address
answer with your bytes or send a 301. Consumers move because you asked them to
and gave them somewhere to go.

## Before you start

- A written list of who reads the current address, and how you will reach each
  of them. Start with the vendor: ask for their access logs, or at minimum for
  the referrers and user agents they see.
- An [administrator account](/features/published-feeds#publishing-is-administered).
- Your static GTFS URL, which the new feed's binding requires.

## The steps

### 1. Build the query, then publish beside them

Follow [Publish a GTFS-Realtime feed](/use-cases/publish-gtfs-realtime) end to
end. Pick a slug you are happy to live with for years, because a slug cannot be
renamed: publishing a new feed is the only way to change it.

Whether the new feed starts public depends on which edition you are running. A
public feed is readable by anyone with the URL, which is what the finished
migration needs and is available in either edition. A private feed answers an
issued token and nothing else, which is the better shape for a staged migration:
you hand one named consumer a credential, watch them read it for a fortnight,
and only then go public. Issuing those tokens takes the [enterprise](/editions)
pack, so on a community build a private feed serves nobody and public from the
start is the only path. See [Distribute a feed to a named
partner](/use-cases/feed-to-a-partner) for the staged version.

### 2. Prove the two feeds say the same thing

Run the same validator over both addresses, at roughly the same moment, against
the same static archive. This is the one place in these guides that reaches for
a command-line tool, and the reason is specific: the vendor's feed never passes
through your node, so nothing here holds a verdict on it. Your own feed's
verdict is on its page.

```bash
pip install gtfs-rt-validator

gtfs-rt-validator -gtfs static-feed.zip \
  -vp https://vendor.example.com/gtfs-rt/vehiclepositions \
  --out reports/vendor/

gtfs-rt-validator -gtfs static-feed.zip \
  -vp https://your-node.example.gov/api/public/feeds/vehicles-live \
  --out reports/ours/
```

Then compare the two `report.json` files. Matching reports matter more here than
clean ones. A vendor feed that has been carrying a warning for three years is a
feed consumers have already adapted to, and a new feed that fixes it is a change,
however much of an improvement it is.

Compare the obvious counts as well, since the validator will not: vehicles in
each message, distinct `route_id` values, how many entities carry a `trip_id`.
A feed that publishes 60% of the fleet is conformant and wrong.

Settle the static archive separately, and first. Both reports above are computed
against it, so an archive with problems of its own puts findings in both columns
and tells you nothing about the difference between the two feeds. The validator
service will check an archive on its own: see [Query a static GTFS
archive](/use-cases/static-gtfs-archive#check-the-archive-before-you-rely-on-it).

### 3. Run both, and tell people

Keep both addresses live. Give every consumer you identified the new URL, a date
after which the old one stops, and a name to reply to.

The two feeds are independent: the vendor's is served by them, yours by the
[publish path](/features/published-feeds), and neither knows about the other.
Nothing coordinates them, so watch [Schedules](/features/schedules) and your own
publish history through the overlap rather than assuming the two stay in step.
Those two cover it because publishing reads the query's cached result and records
an attempt; the [Captures](/features/captures) board adds a third view only if
the source behind your new feed has historical capture switched on, which for a
migration is worth doing.

### 4. Cut over

Ask the vendor to stop publishing, or let the contract end. Do not delete
anything on your side to mark the occasion.

Watch for the consumers you never identified. They exist, they will not write to
you, and the only sign of them is traffic that keeps arriving at an address that
has stopped answering. That is the vendor's log, not yours, so ask for one last
read of it a week after the cutover.

## How you know it worked

- Your address validates as clean as, or cleaner than, theirs did, on the same
  static archive.
- The counts in step 2 match.
- The feed's page reads **Serving**, and its publish history is a record of
  publishes rather than a wall of blocked attempts.
- An actual consumer, ideally the fussiest one, confirms they are reading you.

## What takes it off the air

Everything in [the publishing
guide](/use-cases/publish-gtfs-realtime#what-takes-it-off-the-air) applies. Two
that bite specifically during a migration:

- Editing the live feed takes it dark until a new attempt succeeds. During an
  overlap that is survivable; after the vendor is gone it is an outage. Confirm
  the mapping before you cut over, not after.
- Community publishes on demand. If nobody presses the button, nothing
  republishes. A cadence worker is [enterprise](/editions), and it is worth
  settling that question before the vendor's scheduler stops being the thing
  keeping your feed current.
