---
slug: /
sidebar_position: 1
title: Documentation
sidebar_label: Introduction
description: "Veodyn is an open-source, self-hostable transportation data platform. A node is a complete instance for one agency: adapters, normalization, a local warehouse, APIs, and visualization."
---

# Veodyn

The data substrate for regional transportation hubs and agencies.

A node is a complete Veodyn instance scoped to one agency. It pulls from the
systems that agency already runs, normalizes what arrives, stores it locally,
serves it over an API, and draws it. A node is self-hosted and works standing
alone; its source is [`veodyn/veodyn-ce`](https://github.com/veodyn/veodyn-ce)
on GitHub, under the AGPL.

![A Veodyn dashboard showing rail ridership, active fleet vehicles, air quality, and traffic incidents](/img/screenshots/dashboard-view.png)

## Five surfaces

Every node ships all five of them. A hub runs the same five over its own data
and adds federation across the nodes registered with it; that layer is
commercial and is not part of this repository, so these docs describe a node.

| Surface | What it does |
|---|---|
| **Adapters** | Pull from transit, traffic, weather and fleet feeds, and from the SQL warehouses you already have |
| **Normalization** | Harmonize what arrives into typed columns against your own schema conventions |
| **Warehouse** | Local storage on infrastructure you control. The node is the system of record for your data |
| **APIs** | REST, per-query API keys, and a native Model Context Protocol endpoint for agents |
| **Visualization** | Dashboards, embeddable widgets, 15 core chart types, and an assistant that drafts them |

[Architecture](/architecture#the-five-surfaces) maps each surface onto the
services that deliver it.

## What you can do with it

- **Queries**: a full SQL editor with a schema browser, parameters, schedules, forking, and per-query permissions, plus a no-code Visual builder that composes SQL from field picks.
- **Dashboards**: query results arranged on a drag-and-drop grid, with auto-refresh, dashboard-level parameters, annotations, and public share links.
- **Visualizations**: 15 core types (table, chart, counter, pivot, funnel, map, heatmap, sankey, choropleth, cohort, sunburst, word cloud, and more), each with a live-preview editor. Instances can allowlist types and install custom visualization plugins.
- **Data catalog**: browsable datasets with schema, coverage, and freshness, organized into configurable domains (Transit, Freeways, Rail, or whatever your instance defines).
- **Feed health**: whether each upstream feed is current, judged against a cadence you declare, with the datasets it populates named beside it.
- **Create with AI**: a chat that drafts queries, dashboards and snippets, grounded in what your instance actually has, plus SQL generation in the editor. The model writes words; code assigns IDs, so a suggestion can never cite a query that does not exist.
- **Search everything**: one federated search over queries, dashboards and datasets, with a shared tag vocabulary that crosses object types.
- **White-label**: brand name, logo, accent color, chart palette, fonts, domains, and feature flags all come from instance configuration rather than from code.

The [enterprise edition](/editions) adds the management layer on top: KPIs,
governed reports, the alerts surface, wall and presentation modes, shared-link
governance, enterprise SSO, and the AI digest.

## How a node is built

A node is three services behind one origin. Users only ever talk to the
frontend, and every backend call goes through a server-side proxy route
carrying the user's own session, so backend credentials never reach the
browser.

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS v4, shadcn/ui |
| Query service | Flask, SQLAlchemy, PostgreSQL, Redis |
| Sidecar API | Python 3.11, FastAPI, SQLAlchemy 2 |
| Historical warehouse | ClickHouse |
| AI | Anthropic Claude (bring your own key; every AI flow has a manual path) |
| Deployment | Docker images, Helm charts for Kubernetes |

## Where to go next

- [Editions](/editions): node or hub, Community or Enterprise, and what each one includes.
- [Getting Started](/getting-started): run a node locally.
- [Configuration](/configuration): brand it as your own instance.
- [Architecture](/architecture): how the five surfaces map onto the services.
- [Deployment](/operations/deployment): production installation on Kubernetes.
