import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { veodynConfigSchema } from '@/lib/config-schema'
import { resolveDomainIcon } from '@/lib/sidebar-nav'

/**
 * The schema-only half of the config guard: `veodyn.config.example.yaml` must
 * parse and every icon it names must resolve.
 *
 * NOT COVERED here: whether a schema change stays compatible with the real
 * frontend-dev / frontend-prod configs. `helm/envs/` is deploy-only, so that
 * half runs on the deploy repo's `main` and nothing here notices the drift.
 */

describe('the neutral example config', () => {
  it('parses and validates against the schema', () => {
    const raw = readFileSync(join(__dirname, '../../veodyn.config.example.yaml'), 'utf8')
    const parsed = veodynConfigSchema.safeParse(parseYaml(raw))
    expect(parsed.success ? null : parsed.error.issues).toBeNull()
  })

  it('every domain icon resolves to a real one', () => {
    // Operators copy this file, so an icon name outside DOMAIN_ICONS silently
    // renders the default folder.
    const raw = readFileSync(join(__dirname, '../../veodyn.config.example.yaml'), 'utf8')
    const cfg = veodynConfigSchema.parse(parseYaml(raw))
    const fallback = resolveDomainIcon(undefined)
    const unresolved = cfg.domains
      .filter((d) => d.icon != null && resolveDomainIcon(d.icon) === fallback)
      .map((d) => `${d.key}=${d.icon}`)
    expect(unresolved).toEqual([])
  })
})
