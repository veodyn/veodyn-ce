<!--
Read CONTRIBUTING.md if you have not. The short version: one logical change per
pull request, and run the gates for the trees you touched.

Do NOT use a pull request to report a security problem. See SECURITY.md.
-->

## What this changes

<!-- What it does and why. The diff already says what; say why. -->

## Which trees does it touch?

- [ ] `app/` (Next.js frontend)
- [ ] `api/` (FastAPI sidecar)
- [ ] `node/` (query backend, which keeps its own formatting: Black at 119, ruff)
- [ ] `docs/`
- [ ] `helm/`, `ci/`, `compose.yaml`, `scripts/`

## How you verified it

<!-- Which of these you ran, and anything you checked by hand. -->

- [ ] `app/`: `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm test`
- [ ] `api/`: `uv run ruff check .`, `uv run ruff format --check .`,
      `uv run mypy veodyn_api`, `uv run pytest`
- [ ] `node/`: `make test`
- [ ] `./compose/smoke-test.sh` (needed if startup ordering, migrations or
      seeding changed)
- [ ] `python3 scripts/scan-secrets.py`
- [ ] `cd docs && npm run build` (needed if `docs/` changed)
- [ ] Checked it in a browser (screenshots below, if it is a UI change)

<!--
Changed a response model in api/? Run `pnpm gen:api-types` from app/ or the
committed openapi.json diff fails the gate.
-->

## Anything a reviewer should know

<!-- Tradeoffs, things you deliberately left out, follow up work. -->
