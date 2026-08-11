# Contributing

Thanks for looking. This page is about **this** repository: how to get it
running, how to run each of the three test suites, and what the CI gates check,
because they fail for a few reasons that surprise people the first time.

This page, and the root [`SECURITY.md`](SECURITY.md), apply to everything in
the tree, `node/` included.

For a security problem, do not open an issue or a pull request. Read
[`SECURITY.md`](SECURITY.md) first.

## Get it running

Docker and Docker Compose are the only prerequisites:

```bash
docker compose up -d --build
```

That builds and starts all three services and bootstraps itself: both
databases, both migration sets, generated secrets, a seeded admin and a
non admin service account. Nothing is prepared on the host first, and no
credential is committed. [`compose.yaml`](compose.yaml) documents each service,
and the [README](README.md#quick-start) has the port table and how to recover
the generated admin password.

The reproducible check that it all works from nothing is:

```bash
./compose/smoke-test.sh
```

It runs `docker compose down -v` first, so **it deletes this project's
databases** and rebuilds from an empty Docker. Then it waits on every
healthcheck, asserts the three bootstrap containers exited 0, asserts the
frontend, node and the sidecar all answer, checks the sidecar's schema is at
its head revision, verifies both seeded API keys, and signs the admin in
through the frontend's own login route. If you change anything that affects
startup ordering, migrations or seeding, run this before you open a pull
request. It publishes on the same host ports as the stack, and each is
overridable (`VEODYN_APP_PORT`, `VEODYN_REDASH_PORT`, `VEODYN_API_PORT`,
`VEODYN_CLICKHOUSE_PORT`, `VEODYN_MAILDEV_PORT`) if something already holds
one.

If you are only touching the interface, the frontend runs standalone against
bundled demo fixtures with no backend and no database at all: `cd app && pnpm
install && pnpm dev`, with `NEXT_PUBLIC_REDASH_URL` left unset. That mock mode
is a first class backend here, not a stub: the unit suite and the Playwright
baseline both run against it.

## The three suites

Each tree has its own toolchain, and they do not share one.

### `app/`, the frontend (pnpm, Node 24)

```bash
cd app
pnpm install
pnpm lint              # eslint, and see the warning note below
pnpm exec tsc --noEmit
pnpm test              # vitest
pnpm test:e2e          # Playwright against mock mode, port 3100
```

### `api/`, the sidecar (uv, Python 3.11)

```bash
cd api
uv sync --python 3.11
uv run ruff check .
uv run ruff format --check .
uv run mypy veodyn_api
uv run pytest
```

### `node/`, the query backend (Docker, Poetry)

```bash
cd node
make up                # writes node/.env on first run, then brings the stack up
make test              # the backend suite in Docker, then the linters
```

`make test` is `backend-unit-tests` plus `lint`, and `make lint` runs
`ruff check` and `black --check` **on your host**, so it needs both installed
locally. CI runs the suite inside that tree's own
[`.ci/compose.ci.yaml`](node/.ci/compose.ci.yaml) image and runs `ruff check`
there but not `black`, which is not in any of the image's Poetry groups. If
`make lint` is the only thing failing for you, check that first.

## What CI checks

The gates live in [`ci/`](ci/), one file each, and you can read exactly what
they run.

**[`ci/veodyn-de-test.yaml`](ci/veodyn-de-test.yaml)**, the frontend:
`pnpm lint`, `pnpm exec tsc --noEmit`, then Vitest.

- `pnpm lint` is `eslint --max-warnings 0`. **One warning fails the job.**
  There is no tolerated-warning budget, so a lint warning is a build failure
  wearing a different colour.
- **`pnpm test` does not type check.** Vitest transpiles without checking
  types, so a green suite is not a green build. Run `pnpm exec tsc --noEmit`
  yourself; CI will.

**[`ci/veodyn-api-test.yaml`](ci/veodyn-api-test.yaml)**, the sidecar:
`ruff check`, `ruff format --check`, `mypy veodyn_api`, `pytest`, then a
schema diff.

- **`ruff format --check` means formatting alone fails the job**, with every
  test passing and nothing wrong with the logic. Run `uv run ruff format .`
  before you commit.
- **The OpenAPI schema is committed.** The last two lines of that job
  regenerate it and `diff -u` it against
  [`api/openapi.json`](api/openapi.json). Change any response model without
  regenerating and the job fails on the diff. From `app/`, `pnpm gen:api-types`
  regenerates both the schema and the frontend's generated TypeScript types,
  which is the one command that keeps the two halves in step.

**[`ci/redash-test.yaml`](ci/redash-test.yaml)**, node: builds the image,
runs `ruff check`, then the whole backend suite against real PostgreSQL and
Redis. It is gated on `changes`, so a pull request touching neither `node/` nor
that job never pays for the build.

**[`ci/scan-secrets.yaml`](ci/scan-secrets.yaml)**, two guards that need no
build, no database and no services, just a Python interpreter and the checked
out tree:

```bash
python3 scripts/scan-secrets.py        # credential shaped literals, whole tree
python3 scripts/check-public-tree.py   # paths that must not be public
```

Both are plain standard library Python, so run them locally before you push.
[`scripts/scan-secrets.py`](scripts/scan-secrets.py) explains what it scans and
which exceptions are registered, and each registered exception has a test that
fails once the file it names moves or is deleted, so a stale entry cannot sit
there unenforced.

The three test jobs upload a JUnit report, so a failed assertion is named in
the pipeline's Tests tab rather than having to be dug out of a truncated log.

## Conventions

The full set is in
[Development](docs/docs/operations/development.md); these are the ones that
come up in review.

**The browser never talks to a backend.** Every backend call goes through a
same origin route handler under `app/src/app/api/*`, which reads its
configuration server side and forwards the request with the caller's own
session. A new integration gets a route handler, not a `fetch` from a client
component. This is what keeps backend URLs and API keys out of the bundle, and
it is not negotiable.

**Server side configuration goes through the env boundary.** Read it from
[`app/src/lib/env.ts`](app/src/lib/env.ts), add the variable to the schema and
to [`app/.env.local.example`](app/.env.local.example), rather than reaching for
`process.env` in place. `NEXT_PUBLIC_*` values are the exception: Next inlines
them at build time, so read those directly and do not import `env` into client
code.

**Errors at a real failure boundary carry an ID.** Prefer
`throw new AppError(ErrorIds.X, '...', { context })` from
[`app/src/lib/errorIds.ts`](app/src/lib/errorIds.ts) over a bare `throw new
Error(...)`, so logs stay greppable. Trivial invariant guards can stay plain.

**Use the UI primitives.** Raw `<label>`, `<button>` and `<table>` outside
`app/src/components/ui/` are an ESLint error, not a style preference. A control
whose whole label is an icon uses
[`IconButton`](app/src/components/shared/icon-button.tsx) with a `tooltip`,
never the native `title` attribute. Add a missing primitive with the shadcn
CLI from `app/`.

**The product is desktop only.** A narrow viewport layout is not a supported
surface, and a bug that only appears on one is not a defect here.

**Long files get split along real seams.** Around 300 lines is where this
repository starts looking for one (types, constants, validation, a hook,
presentational versus container). Splitting a coherent component just to hit a
number is worse than leaving it.

**`node/` keeps its own conventions.** Its formatting is Black at 119 columns
and ruff, not this repository's, and its layout and idioms are its own. Follow
the tree you are in.

These apply to code you are already touching. None of them is a mandate to go
and refactor something else.

## Commits and pull requests

- Branch off the default branch. Do not force push a branch someone is
  reviewing, and do not skip hooks.
- One logical change per pull request. Split unrelated fixes.
- Commit subjects are a short type prefix and an imperative summary
  (`fix: `, `feat: `, `docs: `, `refactor: `, `test: `, `chore: `). Say why in
  the body; the diff already says what.
- Fill in [the pull request template](.github/PULL_REQUEST_TEMPLATE.md). The
  part reviewers actually need is how you verified it.
- Run the gates for the trees you touched before you push. The four jobs above
  are the whole gate, and every one of them can be run locally.
- If you changed behaviour a user sees, update the documentation in the same
  pull request.

## Documentation

The product manual is a Docusaurus site in [`docs/`](docs/docs/intro.md), and
it uses npm rather than pnpm:

```bash
cd docs
npm install
npm start          # live reloading dev server
npm run build      # the production build, which fails on a broken link
```

`npm run build` is the check that matters: a relative link to a page that does
not exist fails it. Run it if you touched anything under `docs/`.

## Licensing your contribution

This repository is under the GNU Affero General Public License, version 3
([`LICENSE`](LICENSE)), and what you contribute is under it too. Two
directories began as another project's code and keep the license file they were
obtained under; [`NOTICE`](NOTICE) says which, and what a redistribution has to
retain.

The maintainers also license this same code commercially, which is how the
enterprise pack is sold. That only works if they hold the rights to do it, so a
contribution from outside the maintainers needs a contributor licence
agreement: you keep the copyright in what you wrote, and you grant the
maintainers the right to distribute it both under the AGPL and under those
other terms. Without it a patch cannot be accepted, however good it is, because
accepting it would make one file in the tree undistributable on the commercial
side.

The agreement text is not in this repository yet. Until it is, open the pull
request as usual and expect that question on it before it merges.
