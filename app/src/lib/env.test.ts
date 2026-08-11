import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('env', () => {
  it('applies defaults when variables are unset', async () => {
    vi.stubEnv('REDASH_URL', undefined)
    vi.stubEnv('DISABLE_TELEMETRY', undefined)

    const { env } = await import('@/lib/env')

    expect(env.REDASH_URL).toBe('')
    expect(env.DISABLE_TELEMETRY).toBe(false)
  })

  it('keeps an explicitly empty value distinct from an unset one', async () => {
    // CATALOG_API_URL is optional with no default, so unset yields undefined
    // (asserted below). An operator who writes `CATALOG_API_URL=` has said
    // something different from leaving the line out, and the schema has to
    // carry that through rather than collapsing both to undefined.
    vi.stubEnv('CATALOG_API_URL', '')

    const { env } = await import('@/lib/env')

    expect(env.CATALOG_API_URL).toBe('')
  })

  it('reads a provided value', async () => {
    vi.stubEnv('REDASH_URL', 'https://redash.example')

    const { env } = await import('@/lib/env')

    expect(env.REDASH_URL).toBe('https://redash.example')
  })

  it('CATALOG_API_URL is optional: undefined when unset, read when provided', async () => {
    vi.stubEnv('CATALOG_API_URL', undefined)
    const unset = await import('@/lib/env')
    expect(unset.env.CATALOG_API_URL).toBeUndefined()

    vi.stubEnv('CATALOG_API_URL', 'http://catalog.example')
    vi.resetModules()
    const { env } = await import('@/lib/env')
    expect(env.CATALOG_API_URL).toBe('http://catalog.example')
  })
})
