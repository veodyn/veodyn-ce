---
sidebar_position: 22
title: Distribute a feed to a named partner
description: "Serving one feed to one named consumer on a credential you issued: the visibility model, the two transports a token travels over, what a refusal tells them, and how rotation works."
---

# Distribute a feed to a named partner

Some feeds go to one named consumer rather than to the public. A neighbouring
agency wants your vehicle positions for a regional trip planner, a contractor
needs your bikeshare data for the duration of a study, or a partner wants an
early look at something before it goes public. In each case there is one reader
you can name, and the data does not have to sit at an anonymous address.

The arrangement for that is a private feed, plus a token issued for it that only
that consumer holds.

## What has to be true

A private feed's address answers a token and nothing else. It is not a softer
kind of public, and membership in your organization is no substitute either.
Signed-in members of the org see the feed's binding, its publish history and
whether it is serving, but they do not see the bytes. Bytes only ever come out
of the public address, and for a private feed that address wants a credential.

Issuing tokens takes the [enterprise](/editions) pack; reading with one does
not. The community build carries the whole serving path, so it will accept a
token on either transport, resolve it, and serve the feed. What it lacks is
anything that mints one. Community registers no resolver at all, so every token
presented to it resolves to nothing and a private feed there serves no one.

On a community deployment, then, declaring a feed private gives you a binding
that will never answer anyone. That is a real thing to do while a feed is being
set up, but it is not a distribution channel. If a partner needs the data today
and this is a community build, the options are a public feed, a query API key,
or the enterprise pack.

The feed's page shows the whole record either way, but where a public feed
prints its URL with a copy button, a private one prints a sentence saying a
token is needed. Printing an address that turns every anonymous reader away
would only send them hunting for a credential the build may not be able to mint.

![A public feed's page: the address with its copy button, the binding, and the publish history. A private feed's page prints a token sentence where the address sits here](/img/screenshots/connect-feed-detail.png)

## Before you start

- An [administrator account](/features/published-feeds#publishing-is-administered).
  Declaring and publishing a feed is admin-only whatever its visibility.
- An enterprise build, if you intend to issue a token.
- The partner's name and a person to write to. The mechanism assumes one
  credential per consumer, so you need a record of who holds which.

## The steps

### 1. Declare the feed private

Follow [Publish a GTFS-Realtime feed](/use-cases/publish-gtfs-realtime) or
[Publish a GBFS feed](/use-cases/publish-gbfs) as usual, and set Visibility to
Private.

Private has one side effect worth knowing about: a public slug is claimed across
the whole instance rather than within your org, and a private one is not. A slug
another tenant already holds, which a public feed refuses with a 409, is
therefore available to a private feed. That is one of the two answers the form
offers when a slug is taken.

The slug still cannot be renamed later, so pick it carefully.

### 2. Issue a token

On an enterprise build the feed's page carries a token panel beneath the
visibility sentence. A community build renders nothing in that slot rather than
a disabled shell, the same as everywhere else an enterprise concept would
otherwise leave an empty frame on screen.

A token is issued for one feed and grants that slug only. A partner reading two
of your feeds holds two tokens, and revoking one leaves the other alone.

If this does not work on an enterprise deployment, one of two things is missing,
and the symptoms differ.

No panel on the page at all means the frontend image was built without the
feature package that fills that slot. The panel is compiled in when the image is
built, from a registry generated over the packages present in the source tree,
and a build that had none installs none. No values-file line turns it on
afterwards; that takes a rebuild and a new release, not a restart.

A panel that is there but cannot issue anything, or an issued token that gets a
404 from the address, points at the other case: the sidecar never imported the
pack. `VEODYN_EXTRA_MODULES` names the modules it imports at startup, and until
the pack is among them nothing registers the token routes or the resolver that
reads a token at serving time. Check the running service rather than the values
file, by reading its live `/openapi.json` for the token paths. See
[Configuration](/configuration#sidecar-api) and
[Editions](/editions#which-one-am-i-running).

### 3. Tell the partner how to present it

There are two transports, accepted equally. Mention both, because which one the
partner can use is usually decided by software they did not write:

```
GET /api/public/feeds/<slug>?token=<token>
```

```
GET /api/public/feeds/<slug>
Authorization: Bearer <token>
```

Suggest the query parameter first. A great many feed pollers are a URL field and
nothing else, with nowhere to put a header. The cost is that a token in a URL
can be recorded by proxies along the way, which is what rotation is for; this
service redacts it from its own access log.

Only the `Bearer` scheme is read as a token. Any other authorization scheme has
the same effect as presenting nothing.

Presenting the same token both ways serves normally, so a client that attaches
its credential everywhere is fine. Presenting two different ones is refused
instead of arbitrated, because picking a winner would let a consumer go on
reading through a token they believed they had revoked.

### 4. If it is GBFS, warn them about the discovery document

A GBFS feed's address answers with `gbfs.json`, and the member-file URLs inside
it are the plain addresses, with no token in them. A discovery document carrying
a credential would put that credential in every cache and log that ever touched
the file.

The consumer has to append its own token to each member-file request, exactly as
it did to the discovery request. A client that follows the discovery links
verbatim gets a 404 on every member file while the discovery document itself
reads fine.

### 5. Tell them what a refusal will look like

Put this in the email, because the endpoint will not explain itself to them.

Everything the address refuses answers the same 404, with the same body. An
unknown slug, a private feed reached with no token, a wrong token, a revoked
token, an expired token, and a feed that has never published a clean attempt are
indistinguishable from outside. That keeps the address from becoming an oracle a
stranger can probe one guess at a time, and it also means a partner whose
credential died cannot diagnose it themselves.

Give them a name to write to. A consumer holding a dead token cannot tell their
situation apart from a typo in the slug.

The one answer that is not a 404 is staleness, and only under `last known good`:
past the artifact's age cap the endpoint answers 503 with a `Retry-After`. That
branch is reached only after a token has already resolved, so it never discloses
a feed to a reader the feed is closed to.

### 6. Rotate by overlap, never by swap

Tokens are per consumer and independent, so rotation is three steps in this
order:

1. Issue a second token for the same feed.
2. Give it to the partner and confirm they are reading with it.
3. Revoke the first.

Both tokens work during the overlap, so the change is invisible to the consumer.
Revoking first and issuing second produces an outage, with a 404 in the middle
that the partner cannot tell apart from the feed being deleted.

Set a rotation schedule up front rather than rotating in response to an
incident, and rotate a token travelling in a URL more often than one travelling
in a header.

## How you know it worked

Read the feed the way the partner will, from outside your network, with their
token:

```bash
curl -sI "https://your-node.example.gov/api/public/feeds/regional-vehicles?token=<token>"
```

What counts as a good answer depends on which standard the feed publishes. A
GTFS-Realtime feed answers 200 with `content-type: application/x-protobuf`. A
GBFS feed answers that address with its discovery document, so the content type
is `application/json`, and checking it against the protobuf one would report a
working feed as broken. Either way a 200 means the credential resolved and the
address is reachable. For GBFS, follow it with one member file, token appended
the same way, since that is the request a consumer following the discovery
document actually makes.

Then run the negative case:

```bash
curl -sI "https://your-node.example.gov/api/public/feeds/regional-vehicles"
```

A 404 there means the feed is properly closed. A 200 means the feed is public
and its visibility was set wrong.

Finally, have the partner confirm from their own infrastructure. That also tests
whether the token survived being pasted into their config.

## What takes it off the air

| What happened | What the partner sees |
|---|---|
| You revoked their token, or it expired | 404, indistinguishable from the feed never existing |
| The build is community, or the pack is not loaded | 404 on every request, because nothing resolves any token |
| You edited the live feed | Dark until a new attempt succeeds, the same as any feed. The confirmation says so before you commit |
| The artifact aged past the cap under `last known good` | 503 with `Retry-After`, and only if their token resolved first |
| You switched the feed to public | It serves them, and everyone else. A public feed serves whether or not a token comes with the request, so their client sees no change and neither do you |
| You deleted the feed | 404. There is no undo, and a deleted slug looks the same as one that never existed |

## What this does not do

There are no per-consumer analytics. The token identifies who may read; it does
not record what they read or how often, and nothing here produces a report of a
partner's usage.

A token cannot be scoped to part of a feed. It grants one slug in full, so "the
same feed with fewer vehicles" has to be a second feed bound to a narrower
query.

It also does not manage the relationship. Keep the record of who holds which
token, what they agreed to and when the arrangement should end wherever you keep
your agreements.
