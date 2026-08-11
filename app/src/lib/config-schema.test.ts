import { describe, expect, it } from 'vitest'
import {
  veodynConfigSchema,
  toClientConfig,
  NEUTRAL_CONFIG,
  DEFAULT_BRAND_LOGO,
} from '@/lib/config-schema'

describe('config-schema', () => {
  it('parses an empty object into neutral Veodyn defaults', () => {
    const cfg = veodynConfigSchema.parse({})
    expect(cfg.brand.name).toBe('Veodyn')
    expect(cfg.ai.enabled).toBe(false)
    expect(cfg.domains).toEqual([])
    expect(cfg.theme.fonts.source).toBe('external')
  })

  it('fills in the bundled Veodyn mark when the instance is unbranded', () => {
    expect(veodynConfigSchema.parse({}).brand.logo).toBe(DEFAULT_BRAND_LOGO)
    expect(NEUTRAL_CONFIG.brand.logo).toBe(DEFAULT_BRAND_LOGO)
  })

  it('leaves a renamed tenant without a logo rather than giving them Veodyn’s', () => {
    expect(veodynConfigSchema.parse({ brand: { name: 'RegionHub' } }).brand.logo).toBeNull()
    expect(veodynConfigSchema.parse({ brand: { name: 'RegionHub', logo: '/images/rh.png' } }).brand.logo).toBe(
      '/images/rh.png'
    )
  })

  it('coerces booleanish ai.enabled from a string (env override case)', () => {
    expect(
      veodynConfigSchema.parse({ ai: { enabled: 'true', endpoint: 'https://ai.example' } }).ai.enabled
    ).toBe(true)
    expect(veodynConfigSchema.parse({ ai: { enabled: 'false' } }).ai.enabled).toBe(false)
  })

  it('rejects a malformed accent hex', () => {
    expect(() => veodynConfigSchema.parse({ theme: { accent: 'notacolor' } })).toThrow()
  })

  it('toClientConfig drops server-only ai.endpoint but keeps ai.enabled', () => {
    const cfg = veodynConfigSchema.parse({
      ai: { enabled: true, endpoint: 'https://ai.example' },
      reports: { require_separate_approver: false },
    })
    const client = toClientConfig(cfg)
    expect(client.ai).toEqual({ enabled: true })
    expect((client.ai as Record<string, unknown>).endpoint).toBeUndefined()
    expect(client.reports).toEqual({ require_separate_approver: false })
  })

  it('NEUTRAL_CONFIG is the parsed default', () => {
    expect(NEUTRAL_CONFIG.brand.name).toBe('Veodyn')
    expect(NEUTRAL_CONFIG.reports.require_separate_approver).toBe(true)
  })

  it('rejects an unknown key at the root', () => {
    expect(() => veodynConfigSchema.parse({ nope: true })).toThrow()
  })

  it('rejects an unknown nested key (e.g. a typo like brand.nmae)', () => {
    expect(() => veodynConfigSchema.parse({ brand: { nmae: 'x' } })).toThrow()
  })

  it('rejects a misplaced key such as an ai.key secret in YAML', () => {
    expect(() => veodynConfigSchema.parse({ ai: { key: 'sk-secret' } })).toThrow()
  })

  it('requires ai.endpoint when ai.enabled is true', () => {
    expect(() => veodynConfigSchema.parse({ ai: { enabled: true } })).toThrow(/ai\.endpoint/)
  })

  it('allows ai.enabled true when ai.endpoint is set', () => {
    const cfg = veodynConfigSchema.parse({ ai: { enabled: true, endpoint: 'https://ai.example' } })
    expect(cfg.ai.enabled).toBe(true)
    expect(cfg.ai.endpoint).toBe('https://ai.example')
  })

  it('allows ai.enabled false with no endpoint', () => {
    const cfg = veodynConfigSchema.parse({ ai: { enabled: false } })
    expect(cfg.ai.endpoint).toBeNull()
  })

  // Omitted means "offer every visualization this build registers". Null is the
  // value that says so, and a default of [] would instead read as "offer
  // nothing" and empty the type selector on every instance that never asked.
  it('defaults visualizations.enabled to null, meaning offer everything', () => {
    expect(veodynConfigSchema.parse({}).visualizations.enabled).toBeNull()
    expect(veodynConfigSchema.parse({ visualizations: {} }).visualizations.enabled).toBeNull()
    expect(NEUTRAL_CONFIG.visualizations.enabled).toBeNull()
  })

  it('keeps a visualizations allowlist as written', () => {
    const cfg = veodynConfigSchema.parse({ visualizations: { enabled: ['TABLE', 'MAP'] } })
    expect(cfg.visualizations.enabled).toEqual(['TABLE', 'MAP'])
  })

  // The type selector and the Visual builder are client components, so a rule
  // that stopped at the server would filter nothing. Both fields have to make
  // the crossing, not just the allowlist.
  it('ships the visualizations allowlist and audience overrides to the client', () => {
    const cfg = veodynConfigSchema.parse({
      visualizations: { enabled: ['TABLE'], audience: { EXAMPLE_IMAGE_PANEL: 'analyst' } },
    })
    expect(toClientConfig(cfg).visualizations).toEqual({
      enabled: ['TABLE'],
      audience: { EXAMPLE_IMAGE_PANEL: 'analyst' },
    })
    expect(toClientConfig(veodynConfigSchema.parse({})).visualizations).toEqual({
      enabled: null,
      audience: {},
    })
  })

  // Empty rather than absent, so every reader can index it without a guard.
  it('defaults visualizations.audience to no overrides', () => {
    expect(veodynConfigSchema.parse({}).visualizations.audience).toEqual({})
    expect(NEUTRAL_CONFIG.visualizations.audience).toEqual({})
  })

  // The audience vocabulary is closed. A typo like 'analysts' has to fail at
  // boot, where it is one message, rather than silently leaving a type in the
  // picker an operator meant to hide.
  it('rejects an audience that is not one of the two values', () => {
    expect(() =>
      veodynConfigSchema.parse({ visualizations: { audience: { TABLE: 'analysts' } } })
    ).toThrow()
    expect(
      veodynConfigSchema.parse({ visualizations: { audience: { TABLE: 'internal' } } })
        .visualizations.audience
    ).toEqual({ TABLE: 'internal' })
  })

  // A name this build does not know is tolerated (it is dropped where the list
  // is read); a name that is not a string is a malformed config.
  it('accepts an unknown type name but rejects a non-string one', () => {
    expect(
      veodynConfigSchema.parse({ visualizations: { enabled: ['NOT_IN_THIS_BUILD'] } }).visualizations
        .enabled
    ).toEqual(['NOT_IN_THIS_BUILD'])
    expect(() => veodynConfigSchema.parse({ visualizations: { enabled: [1] } })).toThrow()
    expect(() => veodynConfigSchema.parse({ visualizations: { enabeld: ['TABLE'] } })).toThrow()
  })
})
