---
sidebar_position: 2
title: Getting Started
description: "Run Veodyn locally: the whole stack in one Docker Compose command, or the frontend, the query service and the veodyn-api sidecar brought up one at a time."
---

# Getting Started

This guide brings up a local Veodyn stack for evaluation or development.

Most people want [the one command](#2-the-whole-stack-in-one-command); the
sections after it bring the same three services up one at a time, which is what
you want when you are developing one of them and running the others from your
own machine rather than from a container.

## Prerequisites

- **Docker** and **Docker Compose**. For the one command, that is all.
- **Node.js 24+** and **pnpm 9**, only to run the frontend outside Docker.
- **Python 3.11** and [**uv**](https://docs.astral.sh/uv/), only to run the veodyn-api sidecar outside Docker.

## 1. Clone the repository

The community edition is [`veodyn/veodyn-ce`](https://github.com/veodyn/veodyn-ce)
on GitHub, and it is the whole of what this guide brings up:

```bash
git clone https://github.com/veodyn/veodyn-ce.git veodyn
cd veodyn
```

## 2. The whole stack in one command

```bash
docker compose up -d --build
```

`compose.yaml` at the repository root builds all three services and bootstraps
itself: it creates both databases, runs both migration sets, generates its own
cookie secret and API keys into a volume, seeds a query-service admin plus a separate
non-admin service account for the sidecar, and hands each service the key it
needs. Nothing has to be prepared on the host first, and no credential is
committed to the repository.

It brings up the community edition, which is what this repository builds. There
is no sidecar worker in it; see [Editions](/editions) for why.

Most services declare a healthcheck and everything downstream waits on them, so
`up` does not return until the stack is actually running.

Sign in as the seeded admin, `admin@example.com` unless you set
`VEODYN_ADMIN_EMAIL`. Its password is generated on first boot and printed once,
to the bootstrap container's log:

```bash
docker compose logs redash-bootstrap
```

Set `VEODYN_ADMIN_PASSWORD` before the first `up` to choose one yourself, in
which case nothing is printed.

Every published port is overridable (`VEODYN_APP_PORT`, `VEODYN_REDASH_PORT`,
`VEODYN_API_PORT`, `VEODYN_CLICKHOUSE_PORT`, `VEODYN_MAILDEV_PORT`), which
matters mainly if you also run the query service's own development stack from `node/`,
whose defaults collide with these. PostgreSQL and Redis publish no host port at
all.

To prove the stack works from nothing, `./compose/smoke-test.sh` tears the
volumes down, rebuilds, waits on every healthcheck, and signs the admin in
through the frontend's own login route.

The rest of this page covers the service-at-a-time path, which you can skip
unless you are working on one of the services.

## 3. Frontend only, in mock mode

When `NEXT_PUBLIC_REDASH_URL` is unset, the frontend runs entirely on bundled demo fixtures, with no backend and no database.

```bash
cd app
cp .env.local.example .env.local   # leave NEXT_PUBLIC_REDASH_URL unset
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with the prefilled mock account (`admin@example.com` / `mock`). The sign-in card lists the other mock accounts, and the sidebar footer gets an "Acting as" switcher so one browser can play several roles (useful for seeing which controls an admin gets and a member does not).

Mock mode is a demo rather than a database: writes don't survive a reload, and nothing is fetched from a real backend.

## 4. The query service on its own

The query service owns queries, dashboards, schedules, users, and permissions. It lives in `node/` and ships its own Compose stack:

```bash
cd node
make up
```

`make up` generates `node/.env` (cookie and secret keys), creates the database on first boot, and starts Postgres, Redis, the server, a scheduler, a worker, and maildev. Ports:

| Service | Port |
|---|---|
| query service | **5001** (mapped from container port 5000) |
| PostgreSQL | 15432 |
| ClickHouse | 8123 |
| maildev UI / SMTP | 1080 / 1025 |

Create the first (admin) user:

```bash
docker compose exec server ./manage.py users create_root <email> "<name>" --org default
```

Then point the frontend at it. In `app/.env.local`:

```bash
REDASH_URL=http://localhost:5001
NEXT_PUBLIC_REDASH_URL=http://localhost:5001
REDASH_INTERNAL_API_KEY=<the admin user's API key>   # only the /admin pages use it
```

Restart `pnpm dev` and sign in with the credentials you just created. Queries, dashboards, schedules, users, and the admin pages are now real.

## 5. Optional: the veodyn-api sidecar (catalog, tags, feeds, AI)

Without the sidecar the frontend keeps the data catalog, tags and feed health on fixtures. To make them real:

First create a **service account** in the query service for the sidecar. It acts as that account where a request has no caller to borrow a credential from, so give it its own group holding exactly `create_query`, `execute_query`, `list_dashboards`, `list_data_sources` and `view_query`, and attach that group to your data sources. Don't use the builtin default group, which also grants dashboard editing and `list_users`, neither of which the sidecar uses. This is what the root Compose stack seeds for you; see [Deployment](/operations/deployment) step 5 for why. Copy the account's API key from its profile.

The sidecar keeps its own database. The root Compose stack creates it for
you; on this path you create it yourself, on the Postgres that the query service's stack
started:

```bash
docker exec redash-postgres-1 psql -U postgres -c "CREATE DATABASE veodyn;"

cd api
uv sync --python 3.11
uv run alembic upgrade head

export VEODYN_REDASH_SERVICE_API_KEY=<the service account key>
docker compose -f compose.local.yml up -d --build
curl -s localhost:8090/health
```

The API publishes on host port **8090**. Back in `app/.env.local`:

```bash
KPI_API_URL=http://localhost:8090
REPORTS_API_URL=http://localhost:8090
CATALOG_API_URL=http://localhost:8090
```

The three variables are aliases for the same service; deployments may set any subset, and each unset one leaves its surface on fixtures. The catalog additionally needs ClickHouse configured on the sidecar (`VEODYN_CLICKHOUSE_URL`); without it, `/data` reports the catalog service as unavailable.

## 6. Optional: AI

AI features (Create with AI, SQL generation, converse) need an AI provider. The sidecar implements one under `/ai` using an Anthropic API key. See [AI Provider](/operations/ai-provider) for the full setup; the short version for local work:

```bash
# api side
export VEODYN_AI_RELAY_KEY=<any shared secret>
export VEODYN_AI_API_KEY=<your Anthropic API key>

# app/.env.local
VEODYN_AI__ENABLED=true
VEODYN_AI__ENDPOINT=http://localhost:8090/ai
VEODYN_AI__KEY=<the same shared secret>
```

With AI off, every AI affordance is absent rather than greyed out, and every flow it assists has a manual path.

## 7. Optional: live transit data

The stock instance is data-source-agnostic: connect PostgreSQL, MySQL, ClickHouse, BigQuery, or any other supported source under **Data Sources** and start writing queries. The repository also ships query runners for a live transportation API used by the reference deployment (LA Metro); add one under **Data Sources** like any other source. It is entirely optional, and nothing else in this guide depends on it.

## Where things run

| Service | Local URL |
|---|---|
| Veodyn frontend | http://localhost:3000 |
| query service | http://localhost:5001 |
| veodyn-api | http://localhost:8090 |

## Next steps

- [Configuration](/configuration): rename, re-skin, and feature-flag your instance.
- [Deployment](/operations/deployment): take it to Kubernetes.
