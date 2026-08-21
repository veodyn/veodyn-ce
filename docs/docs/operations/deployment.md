---
sidebar_position: 1
title: Deployment
description: "Production installation on Kubernetes: images, Helm charts, dependencies (PostgreSQL, Redis, ClickHouse), secrets, ingresses, and the first-deploy checklist."
---

# Deployment

The reference deployment runs on Kubernetes with Helm. Each service ships a Dockerfile and the charts live in `helm/charts/`, each with an example values file beside it.

This repository does not contain any particular deployment: the per-environment values, the provisioning scripts, the cluster credentials and the pipeline that pushes releases are specific to whoever is running it, and are configured wherever that deployment lives. The repository's CI builds and tests images; it does not deploy. Nothing in the charts requires any particular CI either, so a pipeline of your own (or a laptop with `helm` and `kubectl`) can drive them.

## What gets deployed

Four charts, of which three are always installed. The frontend and veodyn-api charts accept any release name; the query service chart does not, because three of its worker templates (`adhocworker-`, `genericworker-` and `scheduledworker-deployment.yaml`) hardcode `http://flow-redash` in their health-check probe and no value overrides that URL. Name the query service release something else and its workers probe a service that does not exist. Either install it as `flow`, or turn those probes off with `adhocWorker.disableHealthChecks` / `genericWorker.disableHealthChecks` / `scheduledWorker.disableHealthChecks`, which is what the example values do.

Release names also decide the Service names other releases have to reach: `flow-redash` for the query service, `veodyn-api-api` for the API. Those are the hosts the example values files point at, so the guide and the examples work together as written. The `-redash` suffix in that Service name comes from the chart's own templates and is not something the release name controls.

| Release | Chart | Example values | What it runs |
|---|---|---|---|
| `frontend-app` | `helm/charts/frontend` | `values.example.yaml` | The Next.js frontend (port 3000) |
| `veodyn-api-api` | `helm/charts/veodyn-api` | `values.example.yaml` + `values.example-api.yaml` | The FastAPI sidecar (port 8000) |
| `flow` | `helm/charts/flow/contrib-helm-chart` | `helm/charts/flow/values.example.yaml` | Query service: server, scheduler, ad-hoc worker, scheduled worker, generic worker |
| optional | `helm/charts/veodyn-validator` | `values.example.yaml` | The [feed validator](/features/published-feeds#the-validator) (port 8000), needed only to publish feeds |

The validator is the one chart a deployment can leave out: an instance that publishes no feeds needs no validator, and one that does publishes nothing until the service exists. Its Service name is the release name exactly, with no suffix, and that is what `VEODYN_FEED_VALIDATOR_URL` on the sidecar has to point at.

There is no veodyn-api worker release here. The veodyn-api chart can still
install one, from the same generic deployment template, but the only recurring
job it has ever run evaluates KPIs and that job ships in the
[enterprise pack](/editions). A deployment that has the pack adds a second
release from this chart with a `command` override and an image that carries it;
a community deployment runs the API alone. That is why the chart has a
`values.example-api.yaml` and no `values.example-worker.yaml`.

Every example values file renders on its own, so you can see the manifests a chart produces before writing any values of your own. Each one names, at the top, the keys a real deployment must override. For example:

```bash
helm template example helm/charts/frontend -f helm/charts/frontend/values.example.yaml
```

Three datastores have to exist before any of this starts. The reference deployment installs each from its Bitnami chart into the same namespace; nothing here depends on that choice, and a managed service works as well.

- **PostgreSQL**: the query service's database (`flow`) and, in production, a separate database for veodyn-api.
- **Redis**: shared, with each consumer on its own database index.
- **ClickHouse**: the historical warehouse, with a `historical` database.

## Images

```bash
docker build app/    # node:24-alpine, Next standalone output
docker build api/    # python:3.11-slim + uv
docker build node/   # python:3.13-slim-bookworm, Poetry
```

The query service image is a single Python stage with no frontend build in it. Its React client and `viz-lib` package were deleted, leaving it a headless API; the product UI is the `app/` image above.

Frontend build-time arguments matter: `NEXT_PUBLIC_REDASH_URL` (real-backend mode), `NEXT_PUBLIC_DEMO_PACK`, and `NEXT_PUBLIC_VEODYN_PLUGINS` (which visualization plugin packages are compiled in) are baked at `docker build`, not settable on the pod.

## Values layout and secrets

Environment variables for a pod live in an `app.env` map, with one convention worth knowing: a value written as `secret:KEY_NAME` is rendered as a reference into a shared Kubernetes Secret rather than as a literal. The Secret's name is `app.SharedSecretName`, and `KEY_NAME` is the key inside it. Anything not carrying that prefix is a plain literal in the pod spec.

You create that Secret yourself, by whatever means you already manage secrets; the charts only read it. The query service chart reads `app.SharedSecretName` for its own env maps in exactly the same way, and carries a second mechanism alongside it: `redash.existingSecret` names the Secret holding the query service's five internal keys, which must all exist (empty values are fine for the ones you do not use). One Kubernetes Secret can serve both.

Datastore connection strings are the exception, because they are a whole URI rather than an env value. The query service chart takes `externalPostgreSQLSecret` and `externalRedisSecret`, each a name/key pair pointing at a Secret whose value is the URI. Prefer those over the inline `externalPostgreSQL` / `externalRedis` keys: a password written inline lives in the values file, in whatever passes it, and in the release's stored values, where `helm get values` reads it back.

Values files themselves layer in whatever way suits you. The reference deployment uses a shared base, a per-stage file and a per-service file, and supplies the image, the tag and the ingress hostname with `--set` at deploy time so they appear in no file at all. The example values files list exactly which keys that covers for each chart.

The veodyn-api chart also carries a migration Job as a pre-install/pre-upgrade hook running `alembic upgrade head`; `app.runMigrations` enables it on exactly one release, so two releases sharing the database never race on the schema.

:::caution An enterprise deployment has two migration chains, and the chart has to be told

The enterprise pack carries its own Alembic chain, with its own
`alembic_version_ee` table and its own entry point,
`python -m veodyn_enterprise.migrate`. The wheel ships no `alembic.ini`, so the
community command does not reach it.

Set both `app.runEnterpriseMigrations: true` on the migrating release **and**
`VEODYN_EXTRA_MODULES: veodyn_enterprise.registration` on every release of that
deployment. The two are a pair: routers without the chain means every enterprise
request hits a table that was never created, and the chain without the routers
means four tables nothing serves. The migration Job refuses to render if the
migrating release sets one and not the other, so this is a `helm template`
failure rather than a deployment that comes up green and does not work.

The variable may sit in `app.env` or in `app.baseEnv`; the Job resolves the two
together, the same way the pod does, and requires the module to actually be
named in the result. An empty value or a different module is refused, not
accepted as "the key is there".

:::

:::caution The first enterprise deploy onto an existing database may stop, on purpose

The pre-upgrade hook runs the pack's `migrate preflight` before either chain. On
a new database, and on one that has already been through this, it prints a line
and carries on. On a database that was migrated before the community and
enterprise chains were split, it exits non-zero and stops the deploy.

That database has all seven product tables and only `alembic_version`, so the
enterprise chain believes it has never run: left to itself it starts at `0001`
and fails creating `kpi`. Nothing is damaged when that happens, because Postgres
rolls the whole revision back, but the deploy is blocked either way, and the
preflight at least blocks it with a diagnosis rather than a traceback.

Clearing it is one command, once in the life of the deployment, run against that
database from an image carrying the pack:

```sh
python -m veodyn_enterprise.migrate stamp head
```

Then deploy again. The chart does not run that for you: a stamp is only correct
when the enterprise tables are already the shape the chain's head would have
left them, and a hook can check that the tables exist but not that their shape
matches. The pack's
`docs/migration-runbook.md` is the long form, including how to tell this case
apart from a community deployment merely taking the pack for the first time,
where the stamp would be the wrong thing to do.

:::

## Ingress and TLS

Each chart renders an nginx-class Ingress per configured host with cert-manager TLS (`letsencrypt-prod` cluster issuer). In the reference topology every service has its own public hostname:

| Service | Host pattern |
|---|---|
| Frontend | `<name>.apps.<domain>` |
| Query service | `flow-<name>.apps.<domain>` |
| veodyn-api | `api.<name>.apps.<domain>` |

Because each backend is publicly routable, anything that must always run on a request (token checks, audit logging, rate limits) belongs in the backend that owns it, not in the frontend proxy.

## Security headers

The frontend sends its own security headers. The charts and the ingress do not: nothing in the Helm templates or in any per-environment values file adds a `configuration-snippet` or an `add_header` for these, so no ingress annotation is quietly covering the same ground, and adding one would leave two places setting the same headers.

Sent on every response:

| Header | Value |
|---|---|
| `X-Content-Type-Options` | `nosniff`, which matters most for a proxy streaming backend bodies through |
| `Referrer-Policy` | `strict-origin-when-cross-origin`, since paths here carry share tokens |
| `X-DNS-Prefetch-Control` | `off` |
| `Strict-Transport-Security` | One year, `includeSubDomains`, in production builds only |

The Content-Security-Policy is built per request, nonce-based with `strict-dynamic`. That combination is what makes a nonce workable in an app that code-splits: the nonce authorizes Next's bootstrap, everything it loads inherits trust, and hashed chunk filenames do not each need listing.

Two of its choices look loose and should not be tightened by reflex:

- `style-src` keeps `unsafe-inline`. React and Next both write inline style attributes, and there is no nonce path for those, so removing it ships a policy that breaks the app instead of protecting it.
- `img-src` allows `https:` wholesale. Two features render an image URL that cannot be known in advance: a result cell renders one the query author wrote, and an avatar renders whatever a user set. Restricting it to `self` blanks both. Plain `http` is still refused, and blocking script injection is `script-src`'s job.

Framing is expressed only as `frame-ancestors`, with no `X-Frame-Options`. That header cannot say "deny everywhere except the embed routes", and two mechanisms disagreeing about framing is worse than one. `/login`, `/invite` and `/reset` are reachable without a session but are not embeddable, since a framed sign-in form is the clickjacking case.

:::caution A basemap configured only in YAML is invisible to the policy

MapLibre fetches its style, glyphs and sprites from the basemap host, so those origins have to be in `connect-src`. The policy is built in middleware, which cannot read `veodyn.config.yaml`. A deployment that sets `map.tile_url` there has to set the `VEODYN_MAP__TILE_URL` environment variable as well, which is the documented override for the same key.

It fails visibly: the basemap does not render, and the browser console names the blocked origin.

:::

Check a policy change against a production build rather than the dev server: development keeps `unsafe-eval` and allows websockets, so a dev run proves nothing about what production will permit.

## First-deploy checklist

The order matters here. Every credential has to exist before the release that reads it is installed, and for veodyn-api that is stricter than it sounds: its migration Job is a pre-install hook, so a missing key stalls the install itself rather than one pod.

1. **Provision the datastores**: PostgreSQL, Redis, ClickHouse. Set a real password on each, and keep the ClickHouse password in sync between the datastore itself and the query service's capture settings.
2. **Create the image-pull Secret** in the namespace: a `kubernetes.io/dockerconfigjson` Secret holding credentials for the registry you push to. Every chart names one (`registrySecretName` in the frontend and veodyn-api values, `imagePullSecrets` in the query service values) and every pod template emits it unconditionally, so without it each workload fails image authentication before it ever runs.
3. **Create the application Secrets** in the namespace: the shared Secret carrying every key your values files reference with a `secret:` prefix, and the connection-string Secret that `externalPostgreSQLSecret` names for the query service (plus `externalRedisSecret`, if your Redis has a password). Creating them now with the datastore credentials and adding the query service API keys at step 5 is fine; what matters is that a key is present before the release reading it is installed.
4. **Deploy the query service** from `helm/charts/flow/contrib-helm-chart`. Its install hook creates the schema. Open it once and create the admin user and organization.
5. **Add both query service API keys to the shared Secret**: the admin account's key as `REDASH_INTERNAL_API_KEY` for the frontend, and a service account's key as `VEODYN_REDASH_SERVICE_API_KEY` for veodyn-api. Both releases in the next step require them, and veodyn-api's pre-install migration Job injects the second one, so installing before this step leaves that Job in `CreateContainerConfigError` and the release never finishes installing.

   "Non-admin" is not the bar for the service account. The builtin default group in the query service also grants `create_dashboard`, `edit_dashboard`, `edit_query`, `schedule_query`, `list_alerts`, `list_users` and `view_source`, none of which veodyn-api ever uses, so a leaked key from that group could rewrite dashboards and enumerate your users. Put the account in a dedicated group holding exactly `create_query`, `execute_query`, `list_dashboards`, `list_data_sources` and `view_query`, which is what the local Compose stack seeds (`compose/seed-redash.py`) and what its `compose/verify-seed.py` asserts.

   Data source access is separate from group permissions: it is a `data_source_groups` row, and the query service attaches a new data source to the **default** group only. An account outside that group therefore starts with access to nothing and query execution answers 403. Attach the dedicated group to each data source, and set `REDASH_ADDITIONAL_DATA_SOURCE_GROUPS` to that group's name so data sources created later are attached at creation instead of depending on someone remembering the groups UI.
6. **Deploy the frontend and the veodyn-api releases.**
7. **Configure the instance**: mount your `veodyn.config.yaml` (or set `VEODYN_*` variables) for brand, theme, domains, and features. See [Configuration](/configuration).
8. **AI (optional)**: set the relay keys and the model key; see [AI Provider](/operations/ai-provider), including the note about the key surviving secret rebuilds.
9. **Historical capture (optional)**: set the `REDASH_HISTORICAL_CLICKHOUSE_*` variables, add `historical` to the scheduled worker's `QUEUES` so the capture jobs have a consumer, create a query-service data source pointing at the warehouse, and record its id as `REDASH_HISTORICAL_DATA_SOURCE_ID` so capture cannot loop on itself. Then opt data sources into capture.

Replacing a Secret later does not reach the pods already running on it. A `secretKeyRef` value is read once, when the container starts, so a rotated API key or a corrected typo leaves every running pod on the old value until `kubectl rollout restart deployment/<name>`.

## Upgrades

- Charts deploy with `helm upgrade --install --wait`; re-running is safe.
- veodyn-api schema migrations run automatically in the pre-upgrade hook. One exception, and only ever the first time: an enterprise deploy onto a database migrated before the community and enterprise chains were split stops in that hook until a one-time stamp is run. See the caution under [Values layout and secrets](#values-layout-and-secrets) above.
- The frontend and sidecar share committed API contracts (`openapi.json` and generated types), and the repository's CI diffs them, so contract drift is caught before an image is built.
- After changing anything under `node/`, remember the query service **server** pod only rolls when its pod template changes; a same-tag image update needs an explicit `kubectl rollout restart` of the server deployment.

## Environment parity

The reference setup runs a full staging copy beside production in the same namespace: separate release names off the same charts, its own query service database seeded from a copy of production, its own Redis index, and its own `-dev` images. The repository's CI builds those `-dev` images from any branch, which is the half of this that is shipped; installing and reseeding them is deployment-specific.

If you copy the pattern, make the reseed destructive on purpose. Dropping and re-copying the staging database, and nulling every query schedule in the copy, is what keeps staging cheap to reset and stops it emailing or writing anything on production's behalf.
