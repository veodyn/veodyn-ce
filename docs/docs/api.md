---
sidebar_position: 7
title: Data API
description: "Calling the query service's API with your personal key: the endpoints, running a query with parameters and a cache age, polling a job, and downloading results as JSON, CSV or Excel."
---

# Data API

Everything the interface shows arrives over an HTTP API, and the same API is
open to your own tools: scripts, notebooks, a spreadsheet importer, another
system's scheduler. This page is the reference for calling it with the personal
API key the product hands you.

## The credential

Your personal API key is on your [profile page](/features/settings#your-profile),
masked, with controls to reveal, copy and regenerate it. Send it as an
`Authorization` header, and note the scheme is the word `Key`, not `Bearer`:

```
Authorization: Key <your-api-key>
```

The key acts as you. Every call is checked against the same permissions your
account has in the interface, so the API cannot show you a query, a result or a
dashboard you could not open by clicking. Treat the key like a password, and
regenerate it if it ever leaks; anything using the old key stops working
immediately.

The `?api_key=` query parameter works too, but only on the results endpoints:
the [result file URLs](#result-files) and `POST .../results`. Everywhere else,
the instance's address accepts the header and nothing else, which keeps
credentials out of URLs that get logged. Where both arrive on one request, the
URL key is the one that gets read, so never send a stale URL key alongside a
valid header.

## Where to call

The API lives under your instance's own origin, at `/api/node/`. There is no
separate API host, and no backend address to discover: the instance forwards
the call and its credential to the query service for you. **Connect → APIs** in
the product prints these values with your real address in them.

```bash
curl -H "Authorization: Key <your-api-key>" \
  https://your-node.example.gov/api/node/queries
```

## The endpoints

| Endpoint | Answers |
|---|---|
| `GET /api/node/queries` | Saved queries, paginated. `page` and `page_size` page it, `q` searches, and repeated `tags` narrow (`?tags=a&tags=b`) |
| `GET /api/node/queries/<id>` | One query: its SQL, parameters, schedule, and the id of its latest result |
| `POST /api/node/queries/<id>/results` | The query's results, from cache or from a fresh run. See [Running a query](#running-a-query) |
| `GET /api/node/queries/<id>/results.json` | The latest results as a file. Also `.csv`, `.tsv` and `.xlsx` |
| `GET /api/node/query_results/<id>` | One specific result set, by the id a run handed back |
| `GET /api/node/jobs/<job-id>` | An execution in progress. See [Polling a run](#polling-a-run) |
| `GET /api/node/dashboards` | Dashboards, with the same pagination and search |
| `GET /api/node/dashboards/<id>` | One dashboard, its widgets included |

The same API also carries the query service's writes, creating and editing
queries and dashboards under the same permission checks. The read surface
above is the part an integration usually needs.

## Running a query

`POST /api/node/queries/<id>/results` takes a JSON body, every field optional.
`max_age` and `parameters` are below; a third, `apply_auto_limit`, overrides
the saved query's own row-limit setting for this run.

```bash
curl -X POST \
  -H "Authorization: Key <your-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"max_age": 1800, "parameters": {"route_id": "12"}}' \
  https://your-node.example.gov/api/node/queries/42/results
```

`max_age` decides whether a cached result is good enough:

| `max_age` | What you get |
|---|---|
| Omitted, or `-1` | Any cached result. The query only runs if there is none. A deployment that switches on the expired-results TTL caps "any" at that TTL |
| `0` | A fresh run, always |
| `N` | The cached result if it is younger than `N` seconds, otherwise a fresh run |

`parameters` maps each parameter name to its value. A parameterized query needs
every parameter it declares: a missing value is refused with an error naming
it, never quietly defaulted.

The response comes in one of two shapes. A cache hit answers with the result
directly, under a `query_result` key. A fresh run answers with a `job`, because
execution is asynchronous, and you poll it.

### Polling a run

`GET /api/node/jobs/<job-id>` returns the job with a numeric status:

| Status | Means |
|---|---|
| 1, 2, 6, 7 | Not done yet: queued, started, deferred or scheduled. Poll again |
| 3 | Finished. `query_result_id` names the result; fetch it from `/api/node/query_results/<id>` |
| 4 | Did not finish. The `error` string alongside says why, and a run someone cancelled reports here too, as *Query cancelled by user* |

## Result files

`GET /api/node/queries/<id>/results.<format>` returns the latest result as a
download, in `json`, `csv`, `tsv` or `xlsx`.

These URLs accept the key in the URL itself, as `?api_key=`, because a
spreadsheet importer or a browser has nowhere to put a header. Two keys work
there: your personal key, and the query's own results key, a per-query
credential scoped to that one query, its definition included, and nothing
beyond it. The [API Key dialog](/features/queries#the-api-key-dialog) on each
query hands out the complete URLs with the query key already in them, which is
the right credential to give out when the consumer should hold less than your
account can reach.

## What is not on this surface

- **AI clients** connect over [MCP](/features/connect#mcp) instead, with the
  same personal key, and get a read-only tool surface scoped to saved queries
  and dashboards.
- **Anonymous consumers** should not hold your key at all. A public
  [published feed](/features/published-feeds) serves standard formats without
  a credential, and a [share link or embed](/features/sharing) publishes one
  dashboard or visualization by token.
