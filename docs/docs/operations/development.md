---
sidebar_position: 4
title: Development
description: "Working on Veodyn's code: repo layout, dev servers, test suites, contract generation, and the conventions each half keeps."
---

# Development

This page is for people changing Veodyn itself, rather than installing or using it.

## Repository layout

| Path | What it is |
|---|---|
| `app/` | The Next.js frontend (pnpm, TypeScript) |
| `api/` | The FastAPI sidecar (uv, Python 3.11) |
| `node/` | The query service (Poetry, Python 3.13), a headless API with no client of its own. Keeps its own conventions: Black at 119 columns and ruff, not this repository's formatting |
| `helm/`, `ci/` | Deployment charts and pipeline manifests |
| `docs/` | This documentation site (Docusaurus) plus internal engineering notes |

## Frontend (app)

```bash
cd app
pnpm install
pnpm dev          # mock mode when NEXT_PUBLIC_REDASH_URL is unset
pnpm lint         # eslint, zero warnings tolerated
pnpm exec tsc --noEmit
pnpm test         # vitest (note: does not type-check)
pnpm test:e2e     # Playwright against mock mode, port 3100
```

Useful facts:

- **Mock mode is a first-class backend**: the suite, the Playwright baseline, and demos run on bundled fixture packs (`NEXT_PUBLIC_DEMO_PACK`: `neutral` or `la`).
- Backends are server-only; new integrations get a route handler under `src/app/api/*`, never a browser fetch.
- Server env reads go through the validated boundary in `src/lib/env.ts`, and every variable is documented in `.env.local.example`.
- The instance config schema lives in `src/lib/config-schema.ts`; visualization plugins in `src/lib/visualizations/` and `src/plugins/`.

## Sidecar (api)

```bash
cd api
uv sync --python 3.11
uv run pytest
uv run ruff check . && uv run ruff format .
uv run mypy veodyn_api
```

The OpenAPI schema is **committed** (`openapi.json`) and CI diffs it against what the service generates. After changing any response model:

```bash
cd app && pnpm gen:api-types
```

which regenerates both the schema and the frontend's generated types. CI diffs both, so the two halves cannot drift apart unnoticed.

## The query service

```bash
cd node
make up      # the full docker compose stack
make test
make lint
```

It keeps its own formatting rather than this repository's: Black at 119 columns and ruff. Never run `ruff format` there, since Black owns formatting in that tree and the two disagree.

## CI gates

Both app test jobs fail on more than tests, so run the full local gate before pushing:

- **Frontend**: `pnpm lint` (a single warning fails), `tsc --noEmit`, then the suite. A green suite alone is not a green build.
- **Sidecar**: `ruff check`, `ruff format --check`, `mypy`, `pytest`, and the `openapi.json` diff.

## Documentation

This site lives in `docs/`:

```bash
cd docs
npm install
npm start        # live-reloading dev server
npm run build    # the production build; fails on broken links
```
