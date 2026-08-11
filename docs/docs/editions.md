---
sidebar_position: 2
title: Editions
description: "The two things that vary independently: scale (node or hub) and edition (Community or Enterprise), what each capability needs, and how the split is delivered as a build overlay rather than a license key."
---

# Editions

Two things vary, and they vary independently.

- **Scale** is how much the deployment covers. A **node** is a complete Veodyn
  instance scoped to one agency. A **hub** runs everything a node runs over its
  own data, and adds a federation layer that aggregates across the nodes
  registered with it.
- **Edition** is which code is in the image. **Community** is the analyst
  substrate: connect data, normalize it, store it, query it, visualize it,
  arrange it on dashboards, search it, catalog it, and reach all of it through
  the API and MCP. **Enterprise** adds the management and operations layer: the
  surfaces an organization uses to watch numbers, govern who can see what, and
  answer to someone for the result.

Crossing them gives four cells, three of which you can buy:

| | Community | Enterprise |
|---|---|---|
| **Node** | Free and open source, under the AGPL. This repository, in full | Commercial. One agency, plus the management layer |
| **Hub** | Not offered | Commercial, self-operated or operated for you |

There is no community hub. Federation is the whole of what a hub adds, and it
is the commercial part of the product.

## What each capability needs

Everything in the Community column is here, under the
[GNU Affero General Public License, version 3](https://www.gnu.org/licenses/agpl-3.0.html).
Nothing in it is time limited, seat limited, or gated behind a key. Run an
unmodified community build and the license asks nothing of you beyond saying
where the source is; modify it and offer that to users over a network, and your
modified source goes to them too. The enterprise pack is not covered by it and
is licensed commercially.

| Area | Capability | Community | Enterprise |
|---|---|:---:|:---:|
| **Data in** | SQL and warehouse connectors | ● | ● |
| | Transportation connectors (GTFS-RT, GBFS, TMDD, NTCIP 1203, and more) | ● | ● |
| | Normalization to typed columns | ● | ● |
| | Historical capture into ClickHouse | ● | ● |
| **Analysis** | SQL editor, schema browser, parameters | ● | ● |
| | Visual builder (no-code) | ● | ● |
| | Schedules, forking, snippets | ● | ● |
| | Per-query permissions | ● | ● |
| **Presentation** | 15 core visualization types | ● | ● |
| | Visualization plugins | ● | ● |
| | Dashboards, auto-refresh, parameters, annotations | ● | ● |
| | Public dashboard links and embeds | ● | ● |
| | Presentation mode | | ● |
| | Unattended wall mode | | ● |
| **Finding things** | Home, Discover, favorites, tags | ● | ● |
| | Federated search across object types | ● | ● |
| | Data catalog and domain pages | ● | ● |
| | Movers, and the counter row on a domain page | | ● |
| **Watching** | Feed Health and Schedules | ● | ● |
| | KPIs: targets, thresholds, owners, cadence, history | | ● |
| | The alerts surface | | ● |
| **Governing** | Users, groups, data sources, system status | ● | ● |
| | Reports, with snapshots and four-eyes review | | ● |
| | Shared-link audit and bulk revoke | | ● |
| **Interfaces** | REST API and per-query API keys | ● | ● |
| | MCP endpoint | ● | ● |
| | WebSocket streaming | | ● |
| **AI** | SQL generation, Create with AI, converse, Edit with AI | ● | ● |
| | The Home digest and annotation suggestions | | ● |
| **Notifications** | Email and webhook destinations | ● | ● |
| | Chat and paging destinations | | ● |
| **Sign-in** | Password and Google OAuth | ● | ● |
| | SAML, LDAP, header and JWT authentication | | ● |

A hub adds federation on top of an Enterprise image: registering member nodes,
aggregating across them, and pushing selected data back down. None of that is in
this repository, and this documentation describes a node throughout. See
[Architecture](/architecture#nodes-and-hubs) for where the boundary falls.

## How the split is delivered

There is **no license key and no entitlement runtime** anywhere in Veodyn, and
no greyed-out control advertising something you cannot use. The enterprise
features are a separate package, overlaid onto the source tree and installed
into the image before a private image is built. A community image simply does
not contain them:

- the enterprise HTTP routes are not registered, so they answer 404 rather than
  403;
- the enterprise object kinds are not in the object-type registry, so tagging or
  starring one is refused as an unknown kind rather than as a permission
  problem;
- the enterprise database tables belong to a second migration chain that a
  community deployment never runs.

Where a community surface would have shown an enterprise concept, it shows
nothing rather than an empty shell. A [domain page](/features/data-catalog#domain-pages)
in a community build renders its datasets and its dashboards and draws no
counter row at all, because a counter row reading zero would be a claim that
the concept exists here and has no members, which is a different and untrue
statement.

## Which one am I running?

Ask the API for its own route list. A community build serves no path under
`/kpis` or `/reports`:

```bash
curl -s http://<your-api-host>/openapi.json | python3 -c \
  "import json,sys; print(sorted(json.load(sys.stdin)['paths']))"
```

Read the live `/openapi.json` rather than enumerating the application's routes
in a shell: routers included from an installed package do not all expand under
inspection, so that count can under-report a feature that is in fact registered.

## Getting the enterprise edition

Entitlement is which registry you can pull images from. Talk to whoever sold you
the deployment, or to the maintainers.
