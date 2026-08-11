# Starter patterns: apply on touch

These apply to **`app/`** only. `node/` keeps its own conventions; leave it
alone.

Apply each rule when you are **already editing** the relevant code. Never run
any of these as a bulk refactor or a standalone cleanup pass. The goal is that
new and touched code drifts toward these patterns over time, not a big-bang
migration.

- **Editing a file over ~300 lines** and adding to it: consider splitting along
  the seams the file-size hook suggests (types, constants, validation, utils,
  presentational vs container). Do not split a coherent long component just to
  hit a number; split when a real seam exists.

- **Touching a `throw new Error(...)` site** at a meaningful failure boundary:
  route it through the error registry instead:
  `throw new AppError(ErrorIds.X, '...', { context })` (`src/lib/errorIds.ts`).
  Add a new `ErrorIds` entry if no existing cause fits. Trivial invariant guards
  can stay as plain throws.

- **Touching a server-side `process.env.*` read:** move it behind the env
  boundary (`src/lib/env.ts`) and consume `env.X`. Add the var to the schema and
  to `.env.local.example`. `NEXT_PUBLIC_*` vars are exempt (Next inlines them;
  read them directly, do not import `env` into client code).

- **Adding a new backend integration:** do not fetch it from the browser. Add a
  route handler under `src/app/api/*` that reads config from `env` and forwards
  the request, then call that same-origin path from the client.

- **Adding a long-running or cancellable operation** (fetch, streaming, polling):
  thread an `AbortSignal` through it so callers can cancel; pass `signal` down
  rather than swallowing it.

- **Adding a control whose whole label is an icon:** use
  `IconButton` (`src/components/shared/icon-button.tsx`) and give it a `tooltip`
  saying what the click does. It wraps `ui/button` in the shadcn tooltip and
  derives the accessible name from the tooltip, so the two cannot drift; pass
  `aria-label` as well only when the screen reader needs the specific object
  ("Delete Weekly revenue" against a tooltip of "Delete"). Never use the native
  `title` attribute for this: it waits about a second, never reaches the
  keyboard, and cannot be styled. Non-button triggers (a `DropdownMenuTrigger`,
  a `SheetTrigger`, a rail `Link`) compose the same way by hand, wrapping the
  trigger in `Tooltip` / `TooltipTrigger render={...}` / `TooltipContent`.

- **Reaching for a raw `<label>`, `<button>` or `<table>`** outside
  `src/components/ui/`: use the matching primitive instead (`ui/label` with
  `htmlFor`, `ui/button`, `ui/table`). ESLint enforces this with a
  `no-restricted-syntax` error, so a raw element will not pass `pnpm lint`.
  Check `src/components/ui/` before hand-building an interactive control; the
  repo is on Base UI, so add a new primitive with `pnpm dlx shadcn@latest add`
  from `app/` and confirm `@radix-ui` does not enter a source import.

Explicitly out of scope: restructuring directories, rewriting existing error
handling, or converting the API surface wholesale. These are targets for new
code, not a migration mandate.
