// app/src/lib/config.test.ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyEnvOverrides } from '@/lib/config'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('applyEnvOverrides', () => {
  it('sets a nested key from a VEODYN_ env var using __ as separator', () => {
    const out = applyEnvOverrides({}, { VEODYN_BRAND__NAME: 'RegionHub' } as unknown as NodeJS.ProcessEnv)
    expect(out).toMatchObject({ brand: { name: 'RegionHub' } })
  })

  it('overrides a value already present in the base object, parsing JSON booleans', () => {
    const out = applyEnvOverrides({ ai: { enabled: false } }, { VEODYN_AI__ENABLED: 'true' } as unknown as NodeJS.ProcessEnv)
    expect(out).toMatchObject({ ai: { enabled: true } })
  })

  it('ignores env vars without the VEODYN_ prefix', () => {
    const out = applyEnvOverrides({}, { PATH: '/usr/bin' } as unknown as NodeJS.ProcessEnv)
    expect(out).toEqual({})
  })

  it('parses a JSON array env value into an array', () => {
    const out = applyEnvOverrides(
      {},
      { VEODYN_THEME__CHART_PALETTE: '["#ffffff","#000000"]' } as unknown as NodeJS.ProcessEnv
    )
    expect(out).toEqual({ theme: { chart_palette: ['#ffffff', '#000000'] } })
  })

  it('parses a JSON null env value into null', () => {
    const out = applyEnvOverrides({}, { VEODYN_ASSISTANT__WIDGET_URL: 'null' } as unknown as NodeJS.ProcessEnv)
    expect(out).toEqual({ assistant: { widget_url: null } })
  })

  it('falls back to the raw string when the value is not valid JSON', () => {
    const out = applyEnvOverrides(
      {},
      { VEODYN_MAP__TILE_URL: 'https://tiles.example.com/style.json' } as unknown as NodeJS.ProcessEnv
    )
    expect(out).toEqual({ map: { tile_url: 'https://tiles.example.com/style.json' } })
  })

  it('does not route VEODYN_AI__KEY into config (it is a server-only secret)', () => {
    const out = applyEnvOverrides({}, { VEODYN_AI__KEY: 'secret-123' } as unknown as NodeJS.ProcessEnv)
    expect(out).toEqual({})
  })

  it('ignores VEODYN_CONFIG_PATH, which selects the file rather than a key in it', () => {
    const out = applyEnvOverrides({}, { VEODYN_CONFIG_PATH: '/etc/veodyn.yaml' } as unknown as NodeJS.ProcessEnv)
    expect(out).toEqual({})
  })

  // Kubernetes injects a set of link variables for every service in the
  // namespace, so deploying a service named `veodyn-api-dev-api` beside the app
  // put eight VEODYN_-prefixed names into its environment. They became
  // top-level config keys, the strict schema rejected them, and every route
  // answered 500. An override always names a key inside a section, so it always
  // has __; these never do.
  it.each([
    'VEODYN_API_DEV_API_SERVICE_HOST',
    'VEODYN_API_DEV_API_SERVICE_PORT',
    'VEODYN_API_DEV_API_PORT',
    'VEODYN_API_DEV_API_PORT_8000_TCP',
    'VEODYN_API_DEV_API_PORT_8000_TCP_PROTO',
    'VEODYN_API_DEV_API_PORT_8000_TCP_ADDR',
  ])('ignores the Kubernetes service link variable %s', (key) => {
    const out = applyEnvOverrides({}, { [key]: 'tcp://10.43.0.1:8000' } as unknown as NodeJS.ProcessEnv)
    expect(out).toEqual({})
  })
})

describe('loadConfig', () => {
  it('uses neutral defaults when the config file is missing', async () => {
    vi.stubEnv('VEODYN_CONFIG_PATH', '/nonexistent/veodyn.config.yaml')

    const { config } = await import('@/lib/config')

    expect(config.brand.name).toBe('Veodyn')
  })

  it('throws with the field path when a merged value is invalid', async () => {
    vi.stubEnv('VEODYN_CONFIG_PATH', '/nonexistent/veodyn.config.yaml')
    vi.stubEnv('VEODYN_THEME__ACCENT', 'notacolor')

    await expect(import('@/lib/config')).rejects.toThrow(/theme\.accent/)
  })

  it('throws when the config file exists but does not parse to a YAML mapping', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'veodyn-config-'))
    const file = join(dir, 'veodyn.config.yaml')
    writeFileSync(file, '- just\n- an\n- array\n')
    vi.stubEnv('VEODYN_CONFIG_PATH', file)

    await expect(import('@/lib/config')).rejects.toThrow(/does not parse to a YAML mapping/)
  })

  it('uses neutral defaults when the config file is empty (comment-only)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'veodyn-config-'))
    const file = join(dir, 'veodyn.config.yaml')
    writeFileSync(file, '# an empty config is valid\n')
    vi.stubEnv('VEODYN_CONFIG_PATH', file)

    const { config } = await import('@/lib/config')

    expect(config.brand.name).toBe('Veodyn')
  })

  it('applies a JSON array env override to theme.chart_palette', async () => {
    vi.stubEnv('VEODYN_CONFIG_PATH', '/nonexistent/veodyn.config.yaml')
    vi.stubEnv('VEODYN_THEME__CHART_PALETTE', '["#ffffff","#000000"]')

    const { config } = await import('@/lib/config')

    expect(config.theme.chart_palette).toEqual(['#ffffff', '#000000'])
  })

  it('applies a JSON null env override to assistant.widget_url', async () => {
    vi.stubEnv('VEODYN_CONFIG_PATH', '/nonexistent/veodyn.config.yaml')
    vi.stubEnv('VEODYN_ASSISTANT__WIDGET_URL', 'null')

    const { config } = await import('@/lib/config')

    expect(config.assistant.widget_url).toBeNull()
  })

  it('boots when the AI key secret is set (key is not part of config)', async () => {
    vi.stubEnv('VEODYN_CONFIG_PATH', '/nonexistent/veodyn.config.yaml')
    vi.stubEnv('VEODYN_AI__KEY', 'secret-123')

    const { config } = await import('@/lib/config')

    expect(config.brand.name).toBe('Veodyn')
    expect('key' in config.ai).toBe(false)
  })

  it('accepts a numeric env boolean (VEODYN_AI__ENABLED=1) with endpoint set', async () => {
    vi.stubEnv('VEODYN_CONFIG_PATH', '/nonexistent/veodyn.config.yaml')
    vi.stubEnv('VEODYN_AI__ENABLED', '1')
    vi.stubEnv('VEODYN_AI__ENDPOINT', 'https://ai.internal')

    const { config } = await import('@/lib/config')

    expect(config.ai.enabled).toBe(true)
  })

  it('throws when the config file content is literally null', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'veodyn-config-'))
    const file = join(dir, 'veodyn.config.yaml')
    writeFileSync(file, 'null\n')
    vi.stubEnv('VEODYN_CONFIG_PATH', file)

    await expect(import('@/lib/config')).rejects.toThrow(/does not parse to a YAML mapping/)
  })
})
