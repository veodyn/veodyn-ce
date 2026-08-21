---
sidebar_position: 5
title: Take a feed back from a vendor
description: "Moving a public feed from a vendor's address to your own: where the data has to come from, how to prove the two are equivalent, and how to run both until consumers have moved."
---

# Take a feed back from a vendor

A vendor publishes your realtime feed at their address. Riders' apps, the
regional 511, and an aggregator or two read it there. You want it served from
infrastructure you control, without an interruption for the people reading it.

The product half of this migration is small. The part that takes planning is
the consumers.

## What has to be true

A published feed is built from a saved query's results, so what matters is
where that query reads its data from.

| Where your positions live | What to do |
|---|---|
| An AVL, CAD or ITS database you own | Add it as a [data source](/admin/data-sources) and query it. This is the case that actually ends the dependency |
| A GTFS-Realtime websocket stream you can subscribe to | The [`gtfs_realtime` connector](/connectors) samples it and returns a snapshot, one row per vehicle |
| Only the vendor's public protobuf URL | The same connector reads that shape too: point its Feed URL at the `http(s)://` endpoint and each run decodes one snapshot |

The third row is worth being precise about. The ingest works, but it does not
end the dependency: republishing a vendor's HTTP feed through your own address
moves the URL while the supply stays where it was. If their feed stops, yours
stops on the next run, and the outage is now at your address.

It is still a useful step, and often the right first one. Standing your address
up in front of the vendor's data lets consumers migrate while the data path is
unchanged, so the later cutover to your own AVL system is invisible outside the
agency. Plan it as the first of two moves.

Nothing here can redirect the vendor's URL. Their address cannot be made to
answer with your bytes or to send a 301, so consumers only move if you ask them
to and give them somewhere to go.

## Before you start

- A written list of who reads the current address, and how you will reach each
  of them. Start with the vendor: ask for their access logs, or at minimum for
  the referrers and user agents they see.
- An [administrator account](/features/published-feeds#publishing-is-administered).
- Your static GTFS URL, which the new feed's binding requires.

## The steps

### 1. Build the query, then publish beside them

Follow [Publish a GTFS-Realtime feed](/use-cases/publish-gtfs-realtime) end to
end. Pick the slug carefully, because a slug cannot be renamed: publishing a new
feed is the only way to change it.

Whether the new feed starts public depends on which edition you are running. A
public feed is readable by anyone with the URL, which is what the finished
migration needs, and both editions can serve one. A private feed answers an
issued token and nothing else, which suits a staged migration: hand one named
consumer a credential, watch them read it for a fortnight, then go public.
Issuing those tokens takes the [enterprise](/editions) pack, so on a community
build a private feed has no way to serve anyone and the feed has to be public
from the start. See [Distribute a feed to a named
partner](/use-cases/feed-to-a-partner) for the staged version.

### 2. Prove the two feeds say the same thing

Run the same validator over both addresses, at roughly the same moment, against
the same static archive. This is the one place in these guides that uses a
command-line tool, because the vendor's feed never passes through your node and
nothing here holds a verdict on it. Your own feed's verdict is on its page.

```bash
pip install gtfs-rt-validator

gtfs-rt-validator -gtfs static-feed.zip \
  -vp https://vendor.example.com/gtfs-rt/vehiclepositions \
  --out reports/vendor/

gtfs-rt-validator -gtfs static-feed.zip \
  -vp https://your-node.example.gov/api/public/feeds/vehicles-live \
  --out reports/ours/
```

Then compare the two `report.json` files. What matters here is that the reports
match, more than that they are clean. Consumers have already adapted to a vendor
feed that has been carrying a warning for three years, so a new feed that fixes
the warning is still a change for them.

Compare the obvious counts as well, since the validator will not: vehicles in
each message, distinct `route_id` values, how many entities carry a `trip_id`.
A feed that publishes 60% of the fleet can still be conformant.

Settle the static archive first, separately. Both reports above are computed
against it, so an archive with problems of its own puts findings in both columns
and says nothing about the difference between the two feeds. The validator
service will check an archive on its own: see [Query a static GTFS
archive](/use-cases/static-gtfs-archive#check-the-archive-before-you-rely-on-it).

### 3. Run both, and tell people

Keep both addresses live through the overlap. Give every consumer you identified
the new URL, a date after which the old one stops, and a name to reply to.

The two feeds are independent. The vendor serves theirs, the [publish
path](/features/published-feeds) serves yours, and neither knows about the
other. Nothing coordinates them, so watch [Schedules](/features/schedules) and
your own publish history through the overlap instead of assuming the two stay in
step. Those two cover it because publishing reads the query's cached result and
records an attempt. The [Captures](/features/captures) board adds a third view
only if the source behind your new feed has historical capture switched on,
which is worth doing for a migration.

### 4. Cut over

Ask the vendor to stop publishing, or let the contract end. Do not delete
anything on your side at the same time.

Some consumers will not have been identified, and they generally do not write
in. The only sign of them is traffic that keeps arriving at an address that has
stopped answering, and that shows up in the vendor's log rather than yours. Ask
for one last read of it a week after the cutover.

## How you know it worked

- Your address validates as clean as, or cleaner than, theirs did, on the same
  static archive.
- The counts in step 2 match.
- The feed's page reads **Serving**, and its publish history shows successful
  publishes rather than blocked attempts.
- At least one real consumer confirms they are reading the new address.

## What takes it off the air

Everything in [the publishing
guide](/use-cases/publish-gtfs-realtime#what-takes-it-off-the-air) applies. Two
of them matter more during a migration:

- Editing the live feed takes it dark until a new attempt succeeds. During the
  overlap that is survivable. Once the vendor is gone it is an outage, so
  confirm the mapping before you cut over.
- On a community build, publishing happens on demand: if nobody presses the
  button, nothing republishes. A cadence worker is [enterprise](/editions), so
  settle that question before the vendor stops publishing on its own schedule.
