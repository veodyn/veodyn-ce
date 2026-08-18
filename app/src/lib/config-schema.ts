// Pure config schema: shape, neutral defaults, and the client-safe projection.
// No file or process access here (that lives in config.ts), so this module is
// safe to import from tests and from client code for the ClientConfig type.
import { z } from 'zod'

const HEX = /^#[0-9a-fA-F]{6}$/

// Accepts a YAML boolean, an env-string ('true'/'false'/'1'/'0'), or a numeric
// 1/0 (coerceEnvValue JSON-parses env values, so VEODYN_AI__ENABLED=1 arrives
// here as the number 1, not the string '1').
const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0']), z.literal(1), z.literal(0)])
  .transform((v) => v === true || v === 'true' || v === '1' || v === 1)

const hex = z.string().regex(HEX, 'must be a #rrggbb hex color')

// Chart surfaces: the --card token in each theme scope. Charts are drawn on
// cards, not on --background, so these are what the palette is validated
// against.
export const CHART_SURFACE_LIGHT = '#FFFFFF'
export const CHART_SURFACE_DARK = '#12161F'

// The accent, per scope. Both mirror a --primary in globals.css; the dark one
// is hand-picked, not derived from the light one.
export const DEFAULT_ACCENT = '#475569'
export const DEFAULT_ACCENT_DARK = '#7FA9E0'

// Categorical slots, in order: indigo, green, violet, blue, mauve, gold, teal,
// rust. The ORDER is the accessibility mechanism: charts draw series in slot
// order, so adjacent slots clear the adjacent CVD and normal-vision floors. Do
// not reorder or edit a hex without re-running chart-palette.test.ts.
// Eight entries, one per slot, so an 8-series chart never repeats a colour.
export const DEFAULT_PALETTE = [
  '#485EA7', '#2B7E4E', '#A37AC7', '#3570A2', '#89435E', '#BF8A32', '#1D9999', '#B25630',
]

// Same eight hues, re-stepped for the dark card: hand-selected, not derived
// from the light column.
export const DEFAULT_PALETTE_DARK = [
  '#4A61AA', '#2B7E4E', '#754998', '#4D8FC8', '#A05771', '#BF861D', '#1D9999', '#B55933',
]

const aiSchema = z
  .object({
    enabled: booleanish.default(false),
    endpoint: z.string().url().nullable().default(null),
  })
  .strict()
  .default({})
  .refine((ai) => !ai.enabled || ai.endpoint !== null, {
    message: 'ai.endpoint is required when ai.enabled is true',
    path: ['endpoint'],
  })

// The unbranded instance is Veodyn's own, so it ships Veodyn's mark.
export const DEFAULT_BRAND_NAME = 'Veodyn'
export const DEFAULT_BRAND_LOGO = '/images/veodyn-mark.svg'

export const veodynConfigSchema = z.object({
  brand: z
    .object({
      name: z.string().default(DEFAULT_BRAND_NAME),
      logo: z.string().nullable().default(null),
      help_url: z.string().url().nullable().default(null),
      // The product documentation site (the Docusaurus build under docs/),
      // distinct from help_url, which is the tenant's own support site.
      docs_url: z.string().url().nullable().default(null),
    })
    .strict()
    .default({})
    // The bundled mark is filled in only while the name is still Veodyn's. A
    // renamed tenant with no logo of its own gets none, which BrandMark handles.
    .transform((brand) => ({
      ...brand,
      logo: brand.logo ?? (brand.name === DEFAULT_BRAND_NAME ? DEFAULT_BRAND_LOGO : null),
    })),
  theme: z
    .object({
      accent: hex.default(DEFAULT_ACCENT),
      chart_palette: z.array(hex).min(1).default(DEFAULT_PALETTE),
      fonts: z
        .object({
          display: z.string().default('Newsreader'),
          ui: z.string().default('Geist'),
          mono: z.string().default('Geist Mono'),
          source: z.enum(['external', 'bundled']).default('external'),
        })
        .strict()
        .default({}),
    })
    .strict()
    .default({}),
  domains: z
    .array(
      z
        .object({
          key: z.string(),
          label: z.string(),
          icon: z.string().optional(),
        })
        .strict()
    )
    .default([]),
  map: z
    .object({
      tile_url: z.string().url().default('https://demotiles.maplibre.org/style.json'),
    })
    .strict()
    .default({}),
  assistant: z
    .object({
      widget_url: z.string().url().nullable().default(null),
      integration_id: z.string().nullable().default(null),
      sub_agent: z.string().nullable().default(null),
      title: z.string().nullable().default(null),
    })
    .strict()
    .default({}),
  ai: aiSchema,
  // Surfaces an instance can switch off. Default false, not true.
  features: z
    .object({
      query_snippets: booleanish.default(false),
      // The draft workflow: a query is listed only for its author until they
      // publish it. Off means saving a query shares it and "draft" never appears.
      query_drafts: booleanish.default(false),
    })
    .strict()
    .default({}),
  home: z
    .object({
      tagline: z.string().default('The data substrate for regional transportation.'),
    })
    .strict()
    .default({}),
  // Two sections nothing in this edition reads: the enterprise pack owns both
  // readers. The schema is `.strict()`, so an undeclared key fails to parse and
  // an enterprise config would be rejected by the community half of its own app.
  reports: z
    .object({
      require_separate_approver: booleanish.default(true),
    })
    .strict()
    .default({}),
  wall_mode: z
    .object({
      default_dashboard: z.string().nullable().default(null),
    })
    .strict()
    .default({}),
  // Which visualization types an instance offers on CREATION. Null means
  // everything this build registers; a list is an allowlist.
  //
  // Names are NOT checked against the registry here (it lives in the client
  // bundle, and a rollback should degrade the UI rather than refuse to boot).
  // An unrecognized name is warned about once and dropped in
  // src/lib/viz-choices.ts.
  //
  // `audience` overrides a type's own declared audience in either direction.
  // `enabled` is whether the type exists here; `audience` is who is offered it.
  visualizations: z
    .object({
      enabled: z.array(z.string()).nullable().default(null),
      audience: z.record(z.string(), z.enum(['analyst', 'internal'])).default({}),
    })
    .strict()
    .default({}),
})
  .strict()

export type VeodynConfig = z.infer<typeof veodynConfigSchema>

// Client-safe subset: everything except server-only AI internals.
export type ClientConfig = Omit<VeodynConfig, 'ai'> & { ai: { enabled: boolean } }

export function toClientConfig(config: VeodynConfig): ClientConfig {
  const { ai, ...rest } = config
  return { ...rest, ai: { enabled: ai.enabled } }
}

export const NEUTRAL_CONFIG: VeodynConfig = veodynConfigSchema.parse({})
