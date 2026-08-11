import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { veodynConfigSchema } from '@/lib/config-schema'
import { resolveDomainIcon } from '@/lib/sidebar-nav'

/**
 * This file used to also validate the two real deployed configs (frontend-dev
 * and frontend-prod), by reading `app.veodynConfig` straight out of
 * `helm/envs/<env>/frontend-app.yaml` and parsing it against the schema
 * below. That half caught a typo in the mounted config before a
 * `helm upgrade --wait` did: `src/lib/config.ts` throws on an invalid config
 * and is imported at module scope by a server component, so a bad value took
 * down every route with a 500, minutes after the change left anyone's hands,
 * with the message sitting in a pod log.
 *
 * This is a public tree now (the oss half of the reorg described in
 * `docs/superpowers/plans/2026-08-06-reorg-3-deploy-privates.md`), and
 * `helm/envs/` is deploy-only content: real hostnames, tenant ids, and
 * assistant endpoints. It does not ship here. The obvious fix, pointing this
 * test at a committed copy of one of those files, is exactly what its
 * original docstring warned against: a fixture copy would keep passing while
 * the real deployed file drifted from the schema, which is the whole failure
 * mode the guard exists to catch. A copy is not a substitute for the real
 * file, so it was not made one.
 *
 * There is no seam here worth splitting on, unlike the db-logo guard (see
 * `src/components/data-sources/db-logo-manifest.test.ts`), which reproduced
 * itself across two repos by sharing a committed manifest of non-sensitive
 * type names. Any equivalent artifact here would have to be derived from the
 * deployed config itself (domain keys, assistant ids, tile URLs), and
 * committing that is a redacted copy with extra steps, not a genuine seam.
 *
 * So the file-reading half of the guard moved rather than split: it still
 * runs unchanged on `main`, which keeps `helm/envs/` in the same tree as this
 * schema, under this same test file's git history. What is left here is the
 * schema-only half that was always public: the example config
 * (`veodyn.config.example.yaml`, a fictional tenant, not a redacted real one)
 * still has to parse against `veodynConfigSchema` and every icon it names
 * still has to resolve to a real one.
 *
 * NOT COVERED from this repo any more: whether a schema change lands
 * compatibly with the real frontend-dev / frontend-prod configs. That check
 * only runs on the deploy side (main), and only when someone remembers to run
 * it there after a schema change merges here; nothing here notices the drift.
 * Phase 5's cutover checklist (`docs/superpowers/plans/2026-08-04-reorg-roadmap.md`)
 * is where the deploy repo should decide whether to validate against a
 * published schema artifact instead of relying on a shared tree.
 */

describe('the neutral example config', () => {
  it('parses and validates against the schema', () => {
    const raw = readFileSync(join(__dirname, '../../veodyn.config.example.yaml'), 'utf8')
    const parsed = veodynConfigSchema.safeParse(parseYaml(raw))
    expect(parsed.success ? null : parsed.error.issues).toBeNull()
  })

  it('every domain icon resolves to a real one', () => {
    // It is what an operator copies, so an icon name that quietly does nothing
    // is worse here than in any single environment. The example config shipped
    // `train-front` for rail, which is not in DOMAIN_ICONS, so it rendered as
    // the default folder and looked deliberate.
    const raw = readFileSync(join(__dirname, '../../veodyn.config.example.yaml'), 'utf8')
    const cfg = veodynConfigSchema.parse(parseYaml(raw))
    const fallback = resolveDomainIcon(undefined)
    const unresolved = cfg.domains
      .filter((d) => d.icon != null && resolveDomainIcon(d.icon) === fallback)
      .map((d) => `${d.key}=${d.icon}`)
    expect(unresolved).toEqual([])
  })
})
