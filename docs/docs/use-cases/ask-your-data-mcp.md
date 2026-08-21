---
sidebar_position: 17
title: Ask your data from an AI client
description: "Wiring Claude Desktop or an IDE to your instance over MCP: the endpoint, the credential, what the assistant can and cannot reach, and the library work that decides whether it is any use."
---

# Ask your data from an AI client

The Model Context Protocol endpoint lets an AI client read your instance
directly: list the saved queries, run one, read a dashboard. The wiring is an
endpoint and a key. Whether it turns out useful is decided by your query
library, not by the client, and most of this guide is about that half.

## What has to be true

The endpoint is read-only. It lists and runs saved queries and reads dashboards.
It cannot create, edit or delete anything, so connecting a client is not a way
to let an assistant change your instance.

Saved queries are the entire surface. An assistant cannot write new SQL against
your warehouse through this endpoint. It can run what somebody already saved. A
library of eleven queries named `test 3` is a useless MCP connection, and no
amount of prompting fixes that.

The credential is a person's key. It carries your permissions, so an MCP client
can only see what you can see. Treat it like a password.

The whole surface is five tools, and reading their names is the fastest way to
calibrate what to expect: `list_queries`, `get_query`, `run_query`,
`list_dashboards`, `get_dashboard`.

A saved query can reach the history as well as the live data. A query against the
historical warehouse is a saved query like any other, so a library that includes
a few [captured](/use-cases/history-capture) tables gives an assistant the trend
as well as the snapshot. Since capture is offered on every source type, that
surface is as large as you have chosen to make it. The difference in practice is
between an assistant that can say how many bikes are at a station and one that
can say whether that station has been emptying earlier than it did in June.

## Before you start

An account on the instance, and an MCP-capable client: Claude Desktop, an IDE
with MCP support, or anything else speaking the protocol.

## The steps

### 1. Get the endpoint and the config

**Connect → MCP** carries your instance's real `/mcp` URL with a copy button,
and a copyable JSON block for your client's MCP settings. Use the page rather
than assembling the values by hand: it reads its own address, so what it hands
you works as pasted.

### 2. Get your key

**Profile → Security** holds your personal API key, masked, with controls to
reveal, copy and regenerate it. The client authenticates with it as a header:

```
Authorization: Key <your-api-key>
```

Regenerate it if it ever leaks. Anything using the old key stops working
immediately.

### 3. Make the library worth asking

This is the step that decides the outcome. The assistant picks a query by
reading what the library says about itself.

- Name queries as questions or subjects, the way you would say them out loud.
  *Weekday boardings by route, last 90 days* beats *ridership v4*.
- Fill in descriptions. A description is the only place to say what a query
  excludes, which agency it covers, and what its units are. An assistant reading
  `boardings` has no way to know you dropped shuttles.
- Tag consistently. Tags cross object types and are how a subject gets found at
  all. If your instance uses [domains](/features/data-catalog), the
  `domain:<key>` tags are doing this work already.
- Save the warehouse queries too. A captured table nobody has written a saved
  query against is invisible here, however good the [catalog
  entry](/features/data-catalog) for it looks. One saved rollup per captured
  dataset is usually enough to open it up.
- Prefer parameters to near-duplicates. One query with a route parameter is
  something an assistant can use for any route. Fourteen copies with route names
  in the titles are fourteen chances to pick the wrong one.

### 4. Ask something you already know the answer to

The first question through a new connection should be one you can check by hand.
You are testing the wiring and the permissions, not the model.

## How you know it worked

The client lists your queries, running one returns the same rows the query's own
page shows, and a query you know you cannot open does not appear. That last one
matters: it confirms the connection is scoped to your account rather than to the
instance.

## What this does not do

| | |
|---|---|
| Write SQL against your warehouse | No. It runs saved queries |
| Create or edit queries, dashboards or anything else | No. The endpoint is read-only in both editions |
| Give the assistant a credential of its own | No. It uses yours, with your permissions |
| Work without an AI provider configured on the instance | Yes, it works. This is a client of yours talking to your instance. The [in-product AI features](/features/ai) are the separate thing that needs a provider |
