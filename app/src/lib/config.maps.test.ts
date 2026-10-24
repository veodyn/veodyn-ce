import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
})

function configWith(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'veodyn-config-'))
  const file = join(dir, 'veodyn.config.yaml')
  writeFileSync(file, yaml)
  return file
}

const BOTH = `map:
  providers:
    - id: maplibre
      label: Streets
    - id: google
      label: Google
      traffic: true
`

describe('map providers at load', () => {
  it('google_key_is_not_routed_into_config', async () => {
    const { applyEnvOverrides } = await import('@/lib/config')
    const out = applyEnvOverrides({}, { VEODYN_MAPS__GOOGLE__KEY: 'k-123' } as unknown as NodeJS.ProcessEnv)
    expect(out).toEqual({})
  })

  it('google_provider_without_key_is_dropped_with_one_warning', async () => {
    vi.stubEnv('VEODYN_CONFIG_PATH', configWith(BOTH))
    vi.stubEnv('VEODYN_MAPS__GOOGLE__KEY', '')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { config } = await import('@/lib/config')
    expect(config.map.providers).toEqual([{ id: 'maplibre', label: 'Streets' }])
    const mapWarnings = warn.mock.calls.filter(([message]) => String(message).includes('map.providers'))
    expect(mapWarnings).toHaveLength(1)
  })

  it('keeps_google_when_the_env_key_is_set_and_never_stores_the_key_in_config', async () => {
    vi.stubEnv('VEODYN_CONFIG_PATH', configWith(BOTH))
    vi.stubEnv('VEODYN_MAPS__GOOGLE__KEY', 'k-123')
    const { config } = await import('@/lib/config')
    expect(config.map.providers?.map((provider) => provider.id)).toEqual(['maplibre', 'google'])
    expect(JSON.stringify(config)).not.toContain('k-123')
  })

  it('leaves_providers_absent_when_the_instance_names_none', async () => {
    vi.stubEnv('VEODYN_CONFIG_PATH', '/nonexistent/veodyn.config.yaml')
    vi.stubEnv('VEODYN_MAPS__GOOGLE__KEY', 'k-123')
    const { config } = await import('@/lib/config')
    expect(config.map.providers).toBeUndefined()
  })
})
