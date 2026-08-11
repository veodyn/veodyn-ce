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

// The accent, per scope. Both mirror a --primary in globals.css, and the dark
// one is hand-picked rather than derived from the light one for the same reason
// the dark palette below is: selected beats derived. themeStyle() emits this
// pair, so a build that has not overridden theme.accent gets exactly the tokens
// the stylesheet was designed around.
export const DEFAULT_ACCENT = '#475569'
export const DEFAULT_ACCENT_DARK = '#7FA9E0'

// Categorical slots, in order: indigo, green, violet, blue, mauve, gold, teal,
// rust. The ORDER is the accessibility mechanism, not a cosmetic choice: charts
// draw series in slot order, so adjacent slots are what a reader compares, and
// these two columns were selected together to clear the adjacent CVD and
// normal-vision floors in their own mode. Do not reorder, and do not edit a hex
// without re-running the gate in chart-palette.test.ts.
//
// Eight entries, one per slot. The previous 6-entry palette was cycle-filled
// across 8 slots by themeStyle(), so slots 7 and 8 repeated slots 1 and 2 and an
// 8-series chart painted two pairs identically.
export const DEFAULT_PALETTE = [
  '#485EA7', '#2B7E4E', '#A37AC7', '#3570A2', '#89435E', '#BF8A32', '#1D9999', '#B25630',
]

// Same eight hues, re-stepped for the dark card. Not an automatic flip of the
// light column and not derived: hand-selected, then validated as a set.
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

// The unbranded instance is Veodyn's own, so it ships Veodyn's mark
// (public/images/veodyn-mark.svg) rather than a wordmark with nothing beside it.
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
    // tenant that renamed and supplied no logo of their own gets no logo at
    // all, which BrandMark already handles, rather than someone else's eye
    // sitting next to their name.
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
  // Surfaces an instance can switch off. Default false, not true: a feature
  // that ships on has to be worth its nav row on every instance, and Query
  // Snippets is an empty shelf until someone writes one.
  features: z
    .object({
      query_snippets: booleanish.default(false),
      // The draft workflow: authors decide when a query joins the shared list,
      // and until they do it is listed only for them. Off by default because
      // it puts a step between writing a query and colleagues finding it, and
      // most teams would rather everything they save be findable. With it off,
      // saving a query shares it and the word "draft" never appears.
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
  // Two sections nothing in THIS edition reads, and they are declared anyway.
  //
  // `reports.require_separate_approver` is read by the report governance rule
  // and `wall_mode.default_dashboard` by the wall screen, both of which the
  // enterprise pack owns. This schema is `.strict()`, so an instance config
  // naming a key it does not declare fails to parse: leaving these out would
  // mean an enterprise deployment's own veodyn.config.yaml was rejected by the
  // community half of its own app, and the only fix would be an overlay that
  // patches this file. Same argument as the two backend URLs in lib/env.ts.
  // Declaring an unread key is inert; refusing one is not.
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
  // Which visualization types an instance offers when someone CREATES a
  // visualization. Omitted (or null) means everything this build registers;
  // a list is an allowlist.
  //
  // The names are deliberately NOT checked against the registry here. This
  // module is parsed server-side at boot while the registry lives in the
  // client bundle, and more importantly an operator rolling back to an image
  // without some plugin should get a degraded UI rather than a container that
  // will not start. An unrecognized name is warned about once and dropped
  // where the list is read (src/lib/viz-choices.ts).
  //
  // `audience` overrides a type's own declared audience, either direction. A
  // plugin declares whether it is something to analyse with, and this is where
  // an instance disagrees: an image panel promoted to 'analyst' because this
  // deployment does build reports out of it, or a core type demoted to
  // 'internal' because its readers are wall screens. Separate from `enabled`
  // because they answer different questions: `enabled` is whether the type
  // exists here at all, `audience` is who gets offered it.
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
