# CLAUDE.md

Guidance for Claude Code when working in this repository. This is the
monorepo-level file. Subtrees have their own `CLAUDE.md`, and the subtree file
wins for code inside that subtree.

## Repository layout

Three services, plus documentation and deployment config:

- **`app/`** the product frontend: a Next.js 16 / React 19 / TypeScript
  app (App Router, shadcn/ui, Tailwind v4, TanStack Query, Zustand, pnpm). It
  reaches every backend through same-origin `/api/*` proxy routes of its own.
  See `app/CLAUDE.md`.
- **`api/`** a FastAPI sidecar (uv, Python 3.11) owning what the node data
  model does not: KPIs, reports, the data catalog, favorites, tags, feeds and
  the AI provider. It stores no users; identity comes from node.
- **`node/`** the query backend, now a headless API (Flask + SQLAlchemy
  backend, Python via Poetry). Its React client and `viz-lib` visualization
  package were deleted in an earlier phase; the product UI is `app/`. It keeps
  its own conventions and tooling. See `node/CLAUDE.md`.
- **`docs/`** the Docusaurus documentation site, plus engineering notes.
- **`helm/`** generic Helm charts, each with an example values file beside
  it. The per-environment values and the provisioning scripts are deployment
  specific: they exist only in the deploy repository and are absent from the
  community one.
- **`ci/`** test and build jobs; `.gitlab-ci.yml` drives CI. The deploy jobs
  and the values they need are in the deploy repository only.

`node/` is checked in directly (not a git submodule) and is maintained here
like the rest of the tree. Follow its own `CLAUDE.md` and code style
(Black 119, ruff, Prettier) when working in it. The starter patterns below
apply to `app/`, not to `node/`.

## How the services connect

`app` never calls node, the sidecar, or ClickHouse from the browser. All
traffic goes through its own Next.js route handlers under
`app/src/app/api/*`, which read backend URLs and keys from server-side
env vars and forward the request. Auth uses the user's own node session
cookie so node enforces per-user permissions; a separate internal API key is
used only by the admin proxy routes after a session admin check.

## How a deployment is composed and released

A deployment can be the community tree plus one or more **packs**: separate
repositories, each holding a distribution that extends the product without
forking it. In the deploy repository, `docs/deploying.md` is the concrete
runbook (it names the project, namespace and hosts, so it does not travel to
the community repository). What follows is the part that governs how you make
changes, wherever you are working.

**There are two repositories, and the split is by repository, not by branch.**
The deploy repository holds the per-environment values, the deploy jobs and the
provisioning scripts. The community repository (`veodyn-ce`) is the published
tree, has none of those, and **is the one every build actually clones**.
`scripts/public_tree_forbidden_paths.py` lists what must never appear in the
community tree, and `scripts/check-public-tree.py` enforces it there.

The practical consequence, and the one that has already cost a redundant fix:
**a change made in only one of the two is stranded.** The community repository
is not generated from the deploy repository on any schedule, so the same edit
has to land in both. An earlier `oss` branch in the deploy repository used to
play the community role and no longer feeds anything; treat any instruction
that still points at it as stale.

**Releases are tag-gated and automatic.** Every job on a release tag runs
without a manual gate and ships to production. Never push a tag to try
something out. Stage runs the same pipeline with one variable changed, and its
jobs are manual buttons, so stage is where a change gets proven.

**Nothing builds from this checkout.** An assemble step clones the community
tree and each pack, runs the overlays, and hands the composed directory to every
build job as its Docker context. The community tree is cloned at a commit pinned
by each pack's manifest, so core changes reach a deployment when a pack is
re-cut, not when the core moves. Both packs carry the pin and both enforce it.

### The frontend composes at source; the Python services compose as layers

The bundler has to see pack code before `pnpm build`, so a frontend overlay is a
source-tree operation. The two Python services install pack distributions as
image layers and import them at runtime. When you change something, ask which
mechanism it rides: a layer can be added without rebuilding underneath it, a
frontend change cannot.

### Installing a layer does not register it

This has cost four separate releases and it is the first thing to check when a
feature is "deployed" but absent. **An installed layer is inert until a
deployment names it, and the deploy succeeds either way.** node imports
exactly the query runners and destinations its two variables list; the sidecar
imports exactly the modules its extra-modules variable lists; a worker runs
whatever command it is given; the enterprise schema advances only if its
migrations are switched on. Each is a values-file line, not a code change.

Never conclude a feature shipped from a green job, a correct values file, or a
matching image digest. Ask the running process what it registered: query the
runner registry in the pod, or read the live `/openapi.json` rather than
enumerating `app.routes`, which under-reports because `_IncludedRouter` objects
are not expanded.

### Two Alembic chains

Community migrations use `alembic_version`; enterprise migrations use
`alembic_version_ee` via `VERSION_TABLE`. They advance independently. A database
that acquired the enterprise tables some other way has no version row, so the
chain restarts from base and fails on `DuplicateTable`. Stamping is the fix, and
it asserts every earlier revision is already applied, so prove that by diffing
the schema against a database known to be at head before stamping anything.

### Frontend flags are baked at build time

`NEXT_PUBLIC_*` is inlined during `pnpm build`, so plugin selection, backend
mode and demo pack are `--build-arg`s. A running pod cannot be reconfigured into
a different plugin surface; that is a rebuild and a new release. Do not verify
one with `printenv` in the pod, and do not verify it by grepping the bundle for
a plugin's own strings: the first reads empty when the feature is on, the second
matches when it is off, because the composed tree carries the plugin source
either way and the flag gates registration rather than inclusion. What differs
is the flag inlined at the registry call site.

Before trusting any before/after check on a deploy, run it against the old pod
while it is still up and confirm it reports the feature absent. A check that
cannot show absence proves nothing about presence, and once the pod is replaced
that control is gone.

## Git Safety

- Never force push.
- Never skip hooks.
- Never commit secrets. Backend URLs and API keys live in env vars
  (`app/.env.local.example` documents them); `.env*` is gitignored.
- Use heredoc syntax for multi-line commit messages.

## The two test gates fail on formatting, not just on tests

Both CI gates check more than the suite, and each has stopped a deploy for a
change with nothing functionally wrong in it:

- **`veodyn-api`** (`ci/veodyn-api-test.yaml`) runs `ruff check`,
  **`ruff format --check`**, `mypy veodyn_api`, `pytest`, and a diff of
  `openapi.json` against the schema the service generates. Formatting alone is
  enough to fail it, down to a collapsible call or a trailing blank line. Run
  `uv run ruff format .` before committing, and `pnpm gen:api-types` from
  `app/` after changing any response model, or the openapi diff fails.
- **`veodyn-de`** (`ci/veodyn-de-test.yaml`) runs `pnpm lint`
  (`--max-warnings 0`, so one warning fails it), `tsc --noEmit`, and the suite.
  Note `pnpm test` does NOT type-check, so a green suite is not a green `tsc`.

Both jobs upload a junit report, so a failed assertion is named in the
pipeline's Tests tab rather than having to be read out of a log GitLab may have
truncated at 4 MB.

## Implementation Notes

While working a multi-step task against a spec, maintain a running
`<spec>-implementation-notes.md` next to the spec (where `<spec>` is the spec
file's base name). Capture design decisions where the spec was ambiguous,
deliberate deviations and why, tradeoffs considered, and open questions for the
developer. Append entries as decisions come up rather than reconstructing them
at the end. Keep each entry short. This is a working document scoped to the
task, not permanent docs.

## Self-improvement loop

This project captures its own signal and improves from it. You do not need to
do anything special during normal work: the loop runs around you.

- **Signal:** the enforcement hooks append a JSON event to `.harness/ledger.jsonl`
  every time one blocks or warns (file too large, lint failure, silent error).
  The raw ledger is gitignored (local and noisy).
- **Reflect:** run `/reflect` periodically. It reads the ledger, finds recurring
  `(rule, path-prefix)` clusters, reads your `feedback` memories, and proposes
  concrete changes (a new project rule, a hook threshold tweak, a lint rule, or
  an ADR). Nothing is applied without your approval.
- **Measure:** each reflection writes a dated file under `.harness/reflections/`
  holding that run's metric numbers, so two of them can be compared to confirm a
  promoted rule actually reduced the mistakes it targeted. Those files stay in
  the deploy repository and are not part of the community tree: they name
  internal incidents, internal paths and who did what.
  `scripts/check-public-tree.py` fails if one lands in the community
  repository.

Signal is private, and so is the reflection that reads it; what is shared is the
rules a reflection produces.

## Agent tooling

The apply-on-touch conventions are in `.claude/rules/starter-patterns.md`, and
they travel with a clone. The enforcement hooks that go with them do not: they
are installed per-machine rather than committed here, so a fresh clone has the
rules and none of the blocking.

## Project-Specific Instructions

<!-- Add repo-wide instructions below. Half-specific guidance goes in the
     matching subtree CLAUDE.md. -->

### Land a declaration and its uses in one edit, not a sequence

A symbol and the code that uses it have to move together in a **single**
`Write`, or a single `Edit` with `replace_all`. Never as two or more sequential
`Edit`s. This covers **additions**, which are the common case, not just the
rarer rename: an import you are about to use, a prop added to an interface, a
new argument to a hook, a helper you are introducing.

**Why:** `lint-on-edit` runs after every edit, and `--max-warnings 0` means the
half-applied state fails. Add the declaration first and it is briefly unused
(`@typescript-eslint/no-unused-vars`, `F401` under ruff); add the usage first and
the name is briefly undefined (`react/jsx-no-undef`). Both are states you were
one edit away from fixing, and both cost a blocked tool call and a retry.

**How to apply:** for a symbol appearing more than once in a file, prefer `Edit`
with `replace_all: true`. When the change alters the shape of the code around it
(a component splitting in two, an import list being rewritten, a prop threaded
through three files), rewrite the whole file with `Write` instead of walking
through it. Thread a new prop **caller-first** where you can: the parent passing
an unknown prop is not a lint error, while a child declaring an unused one is. If
a sequence really is unavoidable, expect the intermediate block and do not treat
it as a finding.

### Extracting a hook to satisfy the file-size block breaks manual memoization

`check-file-size` blocks at 300 lines, which pushes state out of a component and
into a custom hook. Every `useCallback` in the component that closes over that
state's setters then fails `react-hooks/preserve-manual-memoization`, which is an
ESLint **error**, not a warning.

**Why:** a `useState` setter is known-stable to the React Compiler. The same
setter returned from a custom hook is not, so it becomes an inferred dependency
that the hand-written dep array is missing, and the compiler refuses to preserve
the memoization rather than silently changing when it recomputes.

**How to apply:** move the callbacks that only touch that state into the hook and
return them, rather than returning raw setters. A `setQuery(value)` that also
marks the buffer dirty belongs beside the state it owns; `setQueryText` +
`setIsDirty` exported separately forces every caller to re-derive the pair. Where
a raw setter genuinely must escape, add it to the dep arrays that use it. The
worked example in the tree is `query-editor-page.tsx` and the
`use-query-buffer.ts` it was split into.
