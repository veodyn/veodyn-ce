# api

The Veodyn sidecar: FastAPI on Python 3.11, SQLAlchemy 2 and Alembic, with uv
as the package manager. It owns what the query service's data model does not.

It stores no users. Every request's identity is resolved by forwarding the
caller's own credential to the query service, so permissions stay in one place
and this service never becomes a second answer to "who is this". Where a
request has no caller to borrow a credential from (arming a feed alert,
assembling AI grounding) it acts as a dedicated non-admin service account.

See the root `README.md` for the product, `../docs/` for the user and operator
docs, and `../docs/docs/architecture.md` for how the three services connect.

## What it serves

Thirteen paths, and `openapi.json` in this directory is the committed contract
for all of them:

| Prefix | What |
|---|---|
| `/catalog` | The data catalog: every table the historical warehouse has captured, with schema, coverage, row count and freshness |
| `/domains` | Domain pages, joined from query service tags and whatever counter providers are registered |
| `/tags` | The shared tag vocabulary, and tag writes per object kind |
| `/favorites` | Per-person stars, for the object kinds this build registers |
| `/captures` | Capture health, cadence expectations, and the alert armed from one |
| `/ai` | The AI provider: SQL generation and the creation chat |
| `/health` | Liveness |

## This is the community edition, and it runs no worker

There is no background process here and no queue consumer. The only recurring
job this service has ever had evaluates KPIs, KPIs are enterprise, and the whole
`veodyn_api.worker` package ships in the private `veodyn-enterprise` pack. A
community deployment therefore starts one process, the HTTP API: there is no
`api-worker` service in the root `compose.yaml` and no worker release in
`helm/charts/veodyn-api`.

The pack is not a fork of this tree. It is a separate distribution installed
alongside it, and it arrives through one seam: `VEODYN_EXTRA_MODULES`, a comma
separated list of dotted module paths imported at startup. Importing a module is
what registers whatever it contributes (routers, object kinds, hub counter
providers, jobs). Empty is the community edition. A module named there and not
importable raises rather than being skipped, because a feature that is
configured and silently absent is the worst of the three outcomes.

Two consequences worth knowing before you tidy anything up in here:

- **`rq` and `rq-scheduler` are dependencies that nothing in `veodyn_api`
  imports.** The composed enterprise environment installs the pack on top of
  *this* lock with `--no-deps`, so a pack dependency has to be declared here or
  it is present nowhere. `pyproject.toml` says so at the line.
- **Several `Settings` fields have no reader in this package.** Same reason: a
  pack reads `veodyn_api.settings` rather than declaring settings of its own, so
  one process has one settings object with one env prefix. They are marked
  `Enterprise` in `veodyn_api/settings.py`.

The enterprise half also has a second Alembic chain, in its own
`alembic_version_ee` table, reached through its own entry point. `alembic
upgrade head` here walks the community chain only.

## Running it

The whole stack, from the repository root:

```bash
docker compose up -d --build
```

This directory on its own, against a node you already have:

```bash
uv sync --python 3.11
cp .env.example .env        # then fill in VEODYN_REDASH_URL and the rest
uv run alembic upgrade head
uv run uvicorn veodyn_api.main:app --reload --port 8090
```

`../docs/docs/getting-started.md` section 5 covers the service account this
needs and the database it expects.

## The gates

CI (`ci/veodyn-api-test.yaml`) fails on any of these, including the formatter:

```bash
uv run ruff format --check .
uv run ruff check .
uv run mypy veodyn_api
uv run pytest
uv run python -m veodyn_api.openapi | diff openapi.json -
```

The last one is why `openapi.json` is committed: it is the contract the
frontend's generated types are built from. After changing any response model,
regenerate it and run `pnpm gen:api-types` from `../app`, or both this job and
the frontend's type check fail.

`tests/test_ce_has_no_ee_code.py` is the guard on the edition boundary. It walks
the import graph, ratchets the module list against
`tests/ce_module_allowlist.json`, starts the app in a subprocess with the pack
blocked, and checks the committed contract for enterprise paths and schema keys.
Adding a module here means updating that allowlist in the same commit.
