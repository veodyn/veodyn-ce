---
sidebar_position: 18
title: Publish an open-data page
description: "Giving the public a dashboard they can read without an account, an embed that survives being pasted into someone else's site, and the machine-readable half beside it."
---

# Publish an open-data page

An open-data commitment usually turns into two asks: a page the public can look
at, and something a developer can consume. This covers both, and the handful of
details that decide whether either one still works six months later.

## What has to be true

Most of the public surface here is an unlisted token URL. There is no directory,
no search engine entry point minted by the product, and no per-visitor identity.
Anyone holding the link can read it, and every link can be revoked at its
source.

Tokens are lookup keys rather than secrets embedded in the page: a refusal
renders a neutral page that does not echo the token, so a screenshot of a
failure cannot leak a working link.

| Surface | URL shape | Edition |
|---|---|---|
| Public dashboard | `/dashboards/public/<token>` | Community |
| Public visualization, for an iframe | `/embed/public/<token>` | Community |
| Public report, a frozen approved snapshot | `/reports/public/<token>` | [Enterprise](/editions) |
| Private published feed, read with an issued token | `/api/public/feeds/<slug>?token=<token>` | Community to serve, [enterprise](/editions) to issue the token |

That last row is a different animal from the three above it, and the difference
is who the credential belongs to. A shared link is one URL that everybody you
gave it to holds, so revoking it revokes it for all of them at once. A feed token
is issued per consumer, so one partner can lose access without anybody else
noticing. When somebody asks for "a link to the data" and then turns out to mean
one named organization, that is the row they want: [Distribute a feed to a named
partner](/use-cases/feed-to-a-partner).

## Before you start

A dashboard worth publishing, which in practice means one whose widgets read
queries you would be comfortable defending line by line. Publishing is a
decision about data, and the dialog does not pretend otherwise.

## The steps

### 1. Decide the expiry before you mint the link

Open **Share** on the dashboard. Opening the dialog does nothing: the switch is
what mints or revokes, so you can look without publishing.

While sharing is off, an **expiry** field is available, and leaving it empty
produces a link that stays open until sharing is turned off. Once the link
exists the field is gone, because the expiry was fixed at mint time. Changing it
means revoking and minting again, which changes the URL.

So decide first. A permanent link for a standing public page, a dated one for a
consultation or a comment period.

### 2. Mint it, and check the parameters

With sharing on, the dialog shows the public URL with a copy control and one
warning worth heeding: *parameters with text values are disabled in the shared
version*. A dashboard built around a text parameter will not behave for a
visitor the way it does for you.

Open the public URL in a private window and use it as a member of the public
would. That is the only way to see what they get.

### 3. Know what a visitor sees

A public dashboard drops the sidebar and every app control, leaving the title
and the widget grid. Each widget keeps its data age, **Refresh** and **Expand**,
and tables keep their own search and row count, so a visitor can work with the
data rather than only look at it.

:::note One control on that page is not for them

Each widget also carries **Open query**, pointing into the authenticated
application. A visitor without an account lands on a sign-in page. Everything
else on the page works.

:::

### 4. Embed one chart somewhere else

For a single visualization on the agency's own website, use the **Embed** dialog
on the query, which mints an `/embed/public/<token>` URL and an iframe snippet.
That page is stripped to one visualization and its data: no links, no buttons,
and a browser tab reading only *Shared visualization*, which is what makes it
safe to drop into a page you do not control.

:::caution Two old snippet shapes should be replaced rather than edited

`/embed/query/<queryId>/visualization/<vizId>` authenticates from the reader's
own session. Signed in it renders; signed out it sits on *Loading...*
indefinitely rather than saying it cannot authenticate. The Embed dialog no
longer offers it.

Older snippets also appended the author's email address as an `api_key`
parameter, publishing a real person's address into the markup and referrer logs
of every site they were pasted into, for a value the page never read. Any
snippet containing `api_key=` should be re-minted.

:::

### 5. Publish the machine-readable half

A page is for people. Developers, aggregators and neighbouring agencies want
something their software can read on a schedule.

- If what you hold is transit realtime or bikeshare, [publish a
  feed](/use-cases/publish-gtfs-realtime) in the standard for it. A feed at a
  stable address in a format a consumer already speaks is worth more than a CSV
  download nobody knows about. Bikeshare covers both shapes: [a docked system or
  a free-floating one](/use-cases/publish-gbfs), each with its own GBFS
  vocabulary.
- If it is anything else, a query's own API key gives a URL that returns its
  results as JSON or CSV. See [The API Key
  dialog](/features/queries#the-api-key-dialog). That key is per query, and
  regenerating it invalidates the old URL.

Link the two from each other. A public dashboard that names its feed, and a feed
whose documentation points at a page a human can read, is most of what an open
data portal does.

### 6. Keep a list

Published feeds enumerate themselves. **Connect → Published Feeds**
(`/connect/feeds`) lists every one this instance serves, with its address, the
query behind it, and whether it is public or private, and any signed-in member
can read that list. Nothing needs writing down for those.

Share tokens are the half with no register. A minted dashboard link or embed is
governed where it was minted and appears in no list, so keep your own: what is
published, who asked for it, when it expires. An [enterprise](/editions) build
adds an audit surface with bulk revoke under [Admin → Shared
Links](/admin/system#shared-links) for exactly this reason.

## How you know it worked

Open every link in a private window. The dashboard renders, the embed renders
inside the page you pasted it into, and the feed answers with bytes. Then revoke
one deliberately and confirm it fails cleanly, so you have seen the failure state
before a member of the public does.

## What takes it off the air

| What happened | What a visitor sees |
|---|---|
| Sharing switched off, or the link expired | A neutral refusal page that does not echo the token |
| A widget's query archived | Its widget is gone. Archiving deletes dashboard widgets built on the query's visualizations, and restoring does not bring them back |
| The query stopped refreshing | Stale data with its age shown on the widget. The age is on screen, which is the honest part, but nobody reads it. Watch [Captures](/features/captures) and [Schedules](/features/schedules) instead |
