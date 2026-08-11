# app

The Veodyn product frontend: Next.js (App Router) on React 19 and TypeScript,
with shadcn/ui, Tailwind, TanStack Query and Zustand. pnpm is the package
manager.

Nothing here talks to a backend from the browser. Every request goes to a
route handler under `src/app/api/*`, which reads its configuration from
server-side environment variables and forwards to node or to the `api/`
service. See the root `README.md` for what the product does and how the halves
fit together, and `../docs/` for the user and operator docs.

## Running it

The whole stack, from the repository root:

```bash
docker compose up -d --build
```

This directory on its own, against a backend you already have:

```bash
pnpm install
cp .env.local.example .env.local   # then fill in REDASH_URL and the rest
pnpm dev
```

With `NEXT_PUBLIC_REDASH_URL` unset the app runs entirely on the mock fixtures
in `src/lib/mock-data/`, which is also how the e2e suite runs.

## Checks

```bash
pnpm lint              # eslint, --max-warnings 0
pnpm exec tsc --noEmit # pnpm test does not type-check
pnpm test              # vitest
pnpm test:e2e          # playwright, mock mode, port 3100
pnpm build
```

`pnpm gen:api-types` regenerates `src/types/generated/` from the `api/`
service's OpenAPI schema. Run it after changing any response model there, or
CI's schema diff fails.

Conventions for working in this directory are in `CLAUDE.md`.
