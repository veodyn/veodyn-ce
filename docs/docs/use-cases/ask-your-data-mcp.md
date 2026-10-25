---
sidebar_position: 20
title: Ask your data from an AI client
description: "Wiring Claude Desktop or an IDE to your instance over MCP: the endpoint, the credential, what the assistant can reach, how its proposals reach you, and the library work that decides whether it is any use."
---

# Ask your data from an AI client

The Model Context Protocol endpoint gives an AI client the same tools the
in-product chat has: search the library, read a query or a dashboard, run a
saved query or a new read-only one, and propose a new query, a dashboard or an
edit. Wiring it up takes an endpoint and a key. How useful it turns out to be
depends mostly on your query library rather than on the client, which is what
most of this guide is about.

## What has to be true

The credential is a person's key. It carries your permissions, so an MCP client
can only see and run what you can, and every object it reads is read as you.
Treat the key like a password.

Nothing the client does changes your instance on its own. Reads and runs return
results; a proposal is saved as a draft in a chat conversation of yours, and the
tool's answer carries a link to it. You open the link, see the change as a
before and after, and click Apply. Until you do, nothing is created or edited.

The tools are the chat's tools, listed by the endpoint itself, so a client sees
whatever this instance's chat offers. Proposal tools appear only where chat is
turned on, since their link leads to a chat conversation.

A saved query can reach the history as well as the live data. A query against
the historical warehouse is a saved query like any other, so a library that
includes a few [captured](/use-cases/history-capture) tables gives an assistant
the trend as well as the snapshot. Capture is offered on every source type, so
that surface is as large as you have chosen to make it. Without those tables an
assistant can say how many bikes are at a station; with them it can say whether
that station has been emptying earlier than it did in June.

## Before you start

An account on the instance, and an MCP-capable client: Claude Desktop, an IDE
with MCP support, or anything else speaking the protocol. The instance needs its
AI service set up, though not a model provider: the client brings its own model.

## The steps

### 1. Get the endpoint and the config

**Connect → MCP** carries your instance's real `/mcp` URL with a copy button,
and a copyable JSON block for your client's MCP settings. Use the page rather
than assembling the values by hand; it reads its own address, so what it hands
you works as pasted.

![The MCP page: the server URL and the client configuration snippet](/img/screenshots/connect-mcp.png)

### 2. Get your key

**Profile → Security** holds your personal API key, masked, with controls to
reveal, copy and regenerate it. The client authenticates with it as a header:

```
Authorization: Key <your-api-key>
```

Regenerate it if it ever leaks. Anything using the old key stops working
immediately.

### 3. Make the library worth asking

The assistant picks a query by reading what the library says about itself, which
makes this the step that decides the outcome.

- Name queries as questions or subjects, the way you would say them out loud:
  *Weekday boardings by route, last 90 days* rather than *ridership v4*.
- Fill in descriptions. A description is the only place to record what a query
  excludes, which agency it covers, and what its units are. An assistant reading
  `boardings` has no way to know that shuttles were dropped.
- Tag consistently. Tags cross object types and are how a subject gets found at
  all. If your instance uses [domains](/features/data-catalog), the
  `domain:<key>` tags already do this work.
- Save the warehouse queries too. A captured table with no saved query against
  it is harder to find here, however good its [catalog
  entry](/features/data-catalog) looks. One saved rollup per captured dataset is
  usually enough to open it up.
- Prefer parameters to near-duplicates. One query with a route parameter can be
  used for any route, where fourteen copies with route names in their titles are
  easy to pick wrongly from.

### 4. Ask something you already know the answer to

The first question through a new connection should be one you can check by hand.
At this point you are testing the wiring and the permissions rather than the
model.

## How you know it worked

The client lists the tools, finds your queries, and running one returns the same
rows the query's own page shows. A query you know you cannot open does not
appear, which confirms the connection is scoped to your account rather than to
the instance. Ask it to propose a small change, open the link it returns, and
the card shows the change waiting for your Apply.

## Older clients

Earlier releases offered five tools: `list_queries`, `get_query`, `run_query`,
`list_dashboards` and `get_dashboard`. They still answer for one more release,
each description naming the tool that replaces it, and `run_query` given a
`query_id` behaves as it used to. Move prompts and scripts over to the new
names; the old ones go in the release after.

## What this does not do

| | |
|---|---|
| Change anything without you | No. Proposals wait in a chat conversation until you click Apply |
| Give the assistant a credential of its own | No. It uses yours, with your permissions |
| Read KPIs (Enterprise) | Not yet. The KPI tools run only inside the app for now |
| Work without the instance's AI service | No. The endpoint lists its tools from that service. A model provider is not needed: the client brings its own |
