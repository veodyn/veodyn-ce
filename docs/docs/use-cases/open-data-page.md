---
sidebar_position: 18
title: Publish an open-data page
description: "Giving the public a dashboard they can read without an account, an embed that survives being pasted into someone else's site, and the machine-readable half beside it."
---

# Publish an open-data page

An open-data commitment usually turns into two asks: a page the public can look
at, and something a developer can consume. This covers both, plus the details
that decide whether either one still works six months later.

## What has to be true

Most of the public surface here is an unlisted token URL. The product mints no
directory and no search engine entry point, and there is no per-visitor
identity: whoever holds the link can read it, and every link can be revoked
where it was minted.

Tokens are lookup keys rather than secrets embedded in the page. A refusal
renders a neutral page that does not echo the token, so a screenshot of a
failure does not leak a working link.

| Surface | URL shape | Edition |
|---|---|---|
| Public dashboard | `/dashboards/public/<token>` | Community |
| Public visualization, for an iframe | `/embed/public/<token>` | Community |
| Public report, a frozen approved snapshot | `/reports/public/<token>` | [Enterprise](/editions) |
| Private published feed, read with an issued token | `/api/public/feeds/<slug>?token=<token>` | Community to serve, [enterprise](/editions) to issue the token |

The last row differs from the three above it in who the credential belongs to.
A shared link is a single URL held by everyone you gave it to, so revoking it
cuts off all of them at once. A feed token is issued per consumer, so one
partner's access can be withdrawn on its own. If a request for "a link to the
data" turns out to mean one named organization, that is the row you want:
[Distribute a feed to a named partner](/use-cases/feed-to-a-partner).

## Before you start

A dashboard worth publishing, which in practice means one whose widgets read
queries you would be comfortable defending line by line.

## The steps

### 1. Decide the expiry before you mint the link

Open **Share** on the dashboard. Opening the dialog does not publish anything;
the switch inside it is what mints or revokes the link.

While sharing is off, an **expiry** field is available, and leaving it empty
produces a link that stays open until sharing is turned off. Once the link
exists the field is gone, because the expiry was fixed at mint time. Changing it
means revoking and minting again, which changes the URL.

So decide before you mint: a permanent link for a standing public page, or a
dated one for a consultation or a comment period.

### 2. Mint it, and check the parameters

With sharing on, the dialog shows the public URL with a copy control and a
warning: *parameters with text values are disabled in the shared version*. A
dashboard built around a text parameter will not behave for a visitor the way it
does for you.

Open the public URL in a private window and use it the way a member of the
public would.

### 3. Know what a visitor sees

A public dashboard drops the sidebar and every app control, leaving the title
and the widget grid. Each widget keeps its data age, **Refresh** and **Expand**,
and tables keep their own search and row count.

:::note One control on that page is not for them

Each widget also carries **Open query**, which points into the authenticated
application. A visitor without an account lands on a sign-in page. The rest of
the page is unaffected.

:::

### 4. Embed one chart somewhere else

For a single visualization on the agency's own website, use the **Embed** dialog
on the query, which mints an `/embed/public/<token>` URL and an iframe snippet.
That page is stripped to one visualization and its data, with no links, no
buttons, and a browser tab reading only *Shared visualization*, so it can be
dropped into a page you do not control.

:::caution Two old snippet shapes should be replaced rather than edited

`/embed/query/<queryId>/visualization/<vizId>` authenticates from the reader's
own session. Signed in it renders. Signed out it sits on *Loading...*
indefinitely instead of reporting that it cannot authenticate. The Embed dialog
no longer offers it.

Older snippets also appended the author's email address as an `api_key`
parameter, which put a real person's address into the markup and referrer logs
of every site the snippet was pasted into, for a value the page never read.
Re-mint any snippet containing `api_key=`.

:::

### 5. Publish the machine-readable half

The dashboard covers human readers. Developers, aggregators and neighbouring
agencies want something their software can read on a schedule.

- If what you hold is transit realtime or bikeshare, [publish a
  feed](/use-cases/publish-gtfs-realtime) in the standard for it, since
  consumers already read those formats from a stable address. Bikeshare covers
  both shapes: [a docked system or a free-floating
  one](/use-cases/publish-gbfs), each with its own GBFS vocabulary.
- If it is anything else, a query's own API key gives a URL that returns its
  results as JSON or CSV. See [The API Key
  dialog](/features/queries#the-api-key-dialog). That key is per query, and
  regenerating it invalidates the old URL.

Link the two from each other: the public dashboard should name its feed, and the
feed's documentation should point at a page a human can read.

### 6. Keep a list

**Connect → Published Feeds** (`/connect/feeds`) lists every feed this instance
serves, with its address, the query behind it, and whether it is public or
private. Any signed-in member can read that list, so published feeds need no
register of your own.

Share tokens have no such list. A minted dashboard link or embed is governed
where it was minted and appears nowhere else, so keep your own record of what is
published, who asked for it, and when it expires. An [enterprise](/editions)
build adds an audit surface with bulk revoke under [Admin → Shared
Links](/admin/system#shared-links).

![The Shared Links admin page listing every public link](/img/screenshots/admin-shared-links.png)

## How you know it worked

Open every link in a private window. The dashboard renders, the embed renders
inside the page you pasted it into, and the feed answers with bytes. Then revoke
one deliberately and confirm it fails cleanly, so you know what the refusal looks
like before a member of the public meets it.

## What takes it off the air

| What happened | What a visitor sees |
|---|---|
| Sharing switched off, or the link expired | A neutral refusal page that does not echo the token |
| A widget's query archived | Its widget is gone. Archiving deletes dashboard widgets built on the query's visualizations, and restoring does not bring them back |
| The query stopped refreshing | Stale data, with its age shown on the widget. Visitors rarely read that, so watch [Captures](/features/captures) and [Schedules](/features/schedules) |
