---
sidebar_position: 4
title: Configuration
description: "White-label your Veodyn instance with veodyn.config.yaml: brand, theme, domains, feature flags, AI, and the visualization allowlist, plus the environment variables each service reads."
---

# Configuration

A Veodyn instance is branded and feature-flagged through one YAML file, `veodyn.config.yaml`, read by the frontend server at start. Every key is optional: an empty (or missing) file is a valid config and yields the neutral Veodyn defaults. The annotated template `app/veodyn.config.example.yaml` documents every key against a fictional tenant, so it doubles as the reference for the schema.

Rules worth knowing before editing:

- **The file is validated strictly.** An unknown or misspelled key fails startup with the offending path named, rather than being silently ignored.
- **Any key can be overridden by an environment variable**, using `VEODYN_` plus `__` as the nesting separator: `VEODYN_BRAND__NAME=Meridian`, `VEODYN_AI__ENABLED=true`.
- **Secrets never go in the YAML.** Keys like the AI bearer come from the environment only.
- The file's location can be overridden with `VEODYN_CONFIG_PATH`.

## Brand and theme

```yaml
brand:
  name: "Meridian Transit Authority"
  # logo: /images/meridian-mark.svg   # a path under public/, your own asset
  help_url: https://help.example.com

theme:
  accent: "#2c5282"
  chart_palette: ["#2c5282", "#c41230", "#52c41a", "#722ed1",
                  "#eb2f96", "#faad14", "#13c2c2", "#4a7ab5"]
  # fonts: { display: Newsreader, ui: Geist, mono: Geist Mono, source: external }
```

- `brand.name` appears in the sidebar mark, the browser title, the sign-in card, the Home greeting, and the API/MCP page copy.
- `brand.logo` replaces the bundled Veodyn mark. A renamed tenant with no logo gets its name alone, never Veodyn's mark next to someone else's name.
- `brand.help_url` adds a **Help** row to the sidebar footer and **Documentation** buttons to the Connect pages. Without it, neither exists.
- `theme.accent` drives buttons, links, focus rings, and active navigation. `theme.chart_palette` supplies the color slots every chart draws with and the per-series color picker offers. A palette that fails the bundled accessibility validation warns at boot but still ships.

## Domains

```yaml
domains:
  - { key: transit, label: Transit, icon: bus }
  - { key: freeway, label: Freeways, icon: car }
  - { key: rail, label: Rail, icon: train }
```

Each domain becomes a sidebar row and a domain page at `/data/<key>` collecting that domain's datasets and dashboards. Icons resolve from a small transportation set (bus, car, train, ship, plane, globe, wind, activity), with a folder as the fallback. On an [enterprise](/editions) build the domain page also carries a counter row, and the domain picker in the KPI form reads this same list, offering only "uncategorized" when none is configured.

**This list is the registry, and it is the only one.** A domain exists on an instance if and only if it is named here: `/data/<key>` refuses any other key with **Domain not found**, so a typo in a key is a page that never resolves rather than a page that quietly appears. Leaving the list out, or setting it to `[]`, is a supported configuration and means the instance has no domains at all: no sidebar rows, no domain pages, and no domain filter beside the catalog search box.

**Declaring a key here does not put anything in it.** The list decides which domains exist; a `domain:<key>` tag on a query or dashboard decides what belongs to each one. A newly declared domain is an empty page until content is tagged, and removing a key from this list hides the page without untagging anything, so restoring the key brings its members back. See [how a domain gets its members](/features/data-catalog#how-a-domain-gets-its-members).

## Feature flags

```yaml
features:
  query_snippets: true   # default false
  query_drafts: true     # default false
```

- **Query Snippets**: reusable SQL fragments expanded by a trigger word in the editor. Off means the route 404s and the nav row is absent, not greyed out.
- **Query drafts**: with it on, a saved query stays private (with a Draft badge) until its author picks "Share with the team". This governs the query list, not access: anyone who can reach the data source can still open a draft from its link. Off (the default), the word "draft" appears nowhere.

## AI

```yaml
ai:
  enabled: true
  endpoint: https://your-ai-provider/ai
```

The bearer key is a secret and comes from the environment: `VEODYN_AI__KEY`. With `enabled: false` (the default) every AI affordance is absent. `enabled: true` without an `endpoint` fails validation at startup. See [AI Provider](/operations/ai-provider).

## Other sections

```yaml
home:
  tagline: "LA County Regional Integration of Intelligent Transportation Systems"

map:
  tile_url: https://your-tile-server/style.json   # repoint for on-prem

# The next two configure enterprise features, so they govern nothing on a
# community build, where neither the wall route nor reports exist.
wall_mode:
  default_dashboard: transportation-overview

reports:
  require_separate_approver: true   # the four-eyes rule, default true

assistant:            # an external chat widget on Home; no URL, no widget
  widget_url: https://chat.example.com
  integration_id: my-instance
  title: "Data Assistant"
```

## Visualization allowlist

```yaml
visualizations:
  enabled: [TABLE, CHART, COUNTER, MAP]
  # audience: { SANKEY: internal }
```

`enabled` limits which visualization types an analyst can **create**: only these appear in the type selector and the Visual builder. Omit the section to offer everything the build registers. It never hides a visualization that already exists: a widget saved with a type you later drop still renders. An unknown name is logged once and ignored, so rolling back an image degrades the UI instead of stopping the app.

Custom visualization plugins are compiled into the image and enabled at build time with `NEXT_PUBLIC_VEODYN_PLUGINS` (comma-separated package names); a runtime env var cannot add plugins to an image built without them. **Admin → Plugins** shows what actually registered. See [Visualization Plugins](/operations/plugins) for how the mechanism works and how to author one.

## Environment variables

The YAML governs identity and features. Connection strings and secrets are environment variables, documented exhaustively in `app/.env.local.example` and `api/.env.example`. The ones every deployment touches:

### Frontend (app)

| Variable | Purpose |
|---|---|
| `REDASH_URL` | The query service, for all proxied traffic |
| `NEXT_PUBLIC_REDASH_URL` | Build-time flag: unset runs the app in mock/fixture mode, set uses the real backend |
| `REDASH_INTERNAL_API_KEY` | A super-admin query-service API key; used only by the admin proxy routes |
| `KPI_API_URL`, `REPORTS_API_URL`, `CATALOG_API_URL` | The veodyn-api root, one alias per surface, all three normally the same URL; each unset one leaves its surface on fixtures. The first two reach [enterprise](/editions) endpoints |
| `VEODYN_AI__ENABLED`, `VEODYN_AI__ENDPOINT`, `VEODYN_AI__KEY` | The AI relay (the key is the shared bearer, environment-only) |
| `NEXT_PUBLIC_DEMO_PACK` | Which demo fixture pack the mock mode serves (`neutral` or `la`) |
| `NEXT_PUBLIC_VEODYN_PLUGINS` | Build-time list of visualization plugin packages |

### Sidecar (api)

All prefixed `VEODYN_`:

| Variable | Purpose |
|---|---|
| `VEODYN_REDASH_URL` | Where to resolve identities and run queries |
| `VEODYN_REDASH_SERVICE_API_KEY` | The non-admin service account used where there is no caller to borrow a credential from |
| `VEODYN_DATABASE_URL` | Its own PostgreSQL database |
| `VEODYN_REDIS_URL` | Its own Redis index |
| `VEODYN_CLICKHOUSE_URL` (+ user, password, database) | The warehouse the data catalog reads; empty means the catalog answers 503 |
| `VEODYN_AI_RELAY_KEY`, `VEODYN_AI_API_KEY`, `VEODYN_AI_MODEL` | The AI provider half: the shared bearer, the Anthropic key, the model |
| `VEODYN_FEED_VALIDATOR_URL` | The containerized GTFS-Realtime validator behind [Published Feeds](/features/published-feeds). Empty means none is configured, and every publish attempt then fails closed rather than serving bytes nothing checked |
| `VEODYN_EXTRA_MODULES` | Dotted module paths, comma separated, imported at startup. Empty is the community edition. An [enterprise](/editions) deployment sets it to `veodyn_enterprise.registration`, and a module named here that cannot be imported raises rather than being skipped |
| `VEODYN_REPORTS_REQUIRE_SEPARATE_APPROVER` | Enterprise: server-side enforcement of the four-eyes rule (default true) |

### Query service

The base configuration applies (`REDASH_DATABASE_URL`, `REDASH_REDIS_URL`, mail settings, enabled query runners). These variables keep their `REDASH_` prefix: it is the deployed contract the backend reads, and renaming it would be a migration of every secret and env file rather than a documentation change. Additions on top of the base set:

| Variable | Purpose |
|---|---|
| `REDASH_HISTORICAL_CLICKHOUSE_URL` | Enables historical capture; empty disables it globally |
| `REDASH_HISTORICAL_CLICKHOUSE_USER` / `_PASSWORD` / `_DATABASE` | Warehouse credentials (database defaults to `historical`) |
| `REDASH_HISTORICAL_DATA_SOURCE_ID` | The id of the warehouse's own data source, so its queries are not re-captured into itself |

One caution: `REDASH_SECRET_KEY` doubles as the key encrypting stored data-source configurations. Changing it makes existing data sources undecryptable.
