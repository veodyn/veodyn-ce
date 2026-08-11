# CLAUDE.md (app)

The Next.js frontend. Repo-wide rules (git safety, self-improvement loop, how
this connects to node) live in the root `../CLAUDE.md`; both files load when
you edit code here. This file covers the app itself.

Stack and scripts are not restated here: read `package.json` (and
`components.json` for the shadcn style). pnpm is the package manager.

Two things that file will not tell you: `pnpm test:e2e` runs against mock mode
(`NEXT_PUBLIC_REDASH_URL` unset) on port 3100, overridable with
`PLAYWRIGHT_PORT` when another app holds it, and `pnpm lint` runs with
`--max-warnings 0`, so a warning fails it.

## Layout

`@/*` maps to `src/*` (see `tsconfig.json`).

- **`src/app/`** App Router. Feature routes: admin, alerts, dashboards,
  data-sources, destinations, embed, invite, queries, query-snippets, reset,
  settings, users. **`src/app/api/`** holds the server-side proxy route
  handlers (`node`, plus a deprecated `redash` alias kept for one release)
  that the browser talks to instead of the backends directly. Data-source
  logos are vendored under `public/db-logos/` and served by Next directly,
  with no route handler.
- **`src/components/`** React components grouped by feature, plus `ui/`
  (shadcn primitives) and `shared/`.
- **`src/services/redash/`** the node API client layer (`config.ts` toggles
  mock vs real via `NEXT_PUBLIC_REDASH_URL`). The directory name and the env
  var keep the old spelling on purpose: ~135 files import
  `@/services/redash/...`, and the variable is a deployed contract.
- **`src/lib/`** utilities, including the env boundary and error registry
  (below), `redash-server.ts`, and `mock-data/`.
- **`src/hooks/`, `src/stores/`, `src/types/`** hooks, Zustand stores, shared types.

## Conventions and patterns

- **Backends are server-only.** Never call node or ClickHouse from a
  client component. Add or extend a route handler under `src/app/api/*` and
  fetch that same-origin path from the client.
- **Env boundary (`src/lib/env.ts`).** Server-side config is read and validated
  in one place. New server env reads go through `env`, not scattered
  `process.env.*`. `NEXT_PUBLIC_*` values are the exception: Next inlines them
  at build time, so read those directly where needed and do not import `env`
  into client bundles. Document every env var in `.env.local.example`.
- **Error registry (`src/lib/errorIds.ts`).** Prefer
  `throw new AppError(ErrorIds.X, '...', { context })` over a bare
  `throw new Error(...)` at meaningful failure points, so logs carry a stable,
  greppable ID.

Both patterns are seeds, not a migration mandate. Apply them when you are
already touching the relevant code (see `../.claude/rules/starter-patterns.md`),
not as a bulk refactor.

## Mobile UI is out of scope

This is a **desktop-only product**. Do not build, review, or file findings
against mobile or tablet layouts, and do not spend a verification pass on
narrow viewports.

Consequences worth knowing rather than rediscovering:

- Responsive scaffolding already in the tree is **dead code**, not a feature to
  preserve. `mt-14 md:mt-0` on the app shell implies a mobile top bar that no
  supported viewport ever renders. Remove such classes when you are already
  editing that markup; do not open a sweep for them.
- A missing or broken narrow-viewport layout is **not a defect**. Do not report
  it, and do not add a `sm:`/`md:` variant to "fix" one.
- What still matters is behaviour across **wide** desktop widths, where the real
  bugs live: the content-width cap is not applied uniformly across routes, so a
  narrow form can end up floating in a very wide column. Reproduce a width
  report at the viewport it was filed against before judging it, because a
  layout that looks right at 1440px can be broken at 1900px.

## Adding shadcn/ui components

Use the shadcn CLI so `components.json` config is respected; components land in
`src/components/ui/`.
