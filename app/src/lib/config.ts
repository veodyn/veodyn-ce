// app/src/lib/config.ts
// SERVER ONLY. Loads and validates the instance config once at import.
// Do not import this into a client component or bundle; it reads the
// filesystem and process env. Client code receives toClientConfig(config)
// passed down from a server component (see ConfigProvider).
//
// Precedence: veodyn.config.yaml (or VEODYN_CONFIG_PATH) is the base; a
// missing file is allowed and yields neutral defaults. VEODYN_* env vars
// override individual keys by path (VEODYN_AI__ENDPOINT -> ai.endpoint).
// Secrets (e.g. the AI key) are NOT part of this config; server routes read
// those from process.env directly via the env boundary.
import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { deriveDarkColumn, effectivePalette, formatReport, validatePalette, CHART_PALETTE_SIZE } from '@/lib/chart-palette'
import { CHART_SURFACE_DARK, CHART_SURFACE_LIGHT, veodynConfigSchema, type VeodynConfig } from '@/lib/config-schema'

const CONFIG_PATH = process.env.VEODYN_CONFIG_PATH ?? 'veodyn.config.yaml'

function readConfigFile(path: string): Record<string, unknown> {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {} // no file = neutral defaults
    throw err
  }
  const parsed: unknown = parseYaml(raw)
  if (parsed === null || parsed === undefined) {
    // Empty or comment-only file => neutral defaults (documented in
    // veodyn.config.example.yaml and .env.local.example). But a file whose
    // actual content is `null`/`~` (e.g. a templating error) parses to null
    // too; that is a malformed config and must fail fast rather than
    // silently defaulting.
    const meaningful = raw.replace(/#.*$/gm, '').trim()
    if (meaningful === '') return {}
    throw new Error(
      `[config] ${path} exists but does not parse to a YAML mapping (object) at the root, got null`
    )
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `[config] ${path} exists but does not parse to a YAML mapping (object) at the root, got ${
        Array.isArray(parsed) ? 'an array' : typeof parsed
      }`
    )
  }
  return parsed as Record<string, unknown>
}

// An env var's value is a raw string, but many config fields are not strings
// (theme.chart_palette is an array, assistant.widget_url can be null, ai.enabled
// is a boolean). Try to parse it as JSON first (arrays, null, booleans, numbers,
// or a quoted string), and fall back to the raw string when it is not valid JSON
// (e.g. VEODYN_BRAND__NAME=RegionHub, which is not valid JSON on its own).
function coerceEnvValue(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

// Env keys that look like VEODYN_* config overrides but are not part of the
// merged config object: VEODYN_CONFIG_PATH picks the file to read, and
// VEODYN_AI__KEY is a secret that belongs in the env boundary (env.ts), not
// in config that gets passed to the client via toClientConfig.
const SKIP_ENV_KEYS = new Set(['VEODYN_CONFIG_PATH', 'VEODYN_AI__KEY'])

// An override has to name a key INSIDE a section, so it always contains the __
// separator. Every top-level key in the schema is an object, so a VEODYN_ name
// with no __ can only be something else wearing the prefix.
//
// In Kubernetes that is not hypothetical. The kubelet injects a set of link
// variables for every service in the namespace, so a service named
// `veodyn-api-dev-api` puts VEODYN_API_DEV_API_SERVICE_HOST,
// VEODYN_API_DEV_API_PORT_8000_TCP and six more into every pod. Without this
// check they became top-level config keys, the strict schema rejected them, and
// the whole app answered 500 on every route.
function isConfigOverride(key: string): boolean {
  return key.startsWith('VEODYN_') && key.includes('__') && !SKIP_ENV_KEYS.has(key)
}

export function applyEnvOverrides(
  base: Record<string, unknown>,
  env: NodeJS.ProcessEnv
): Record<string, unknown> {
  const out = structuredClone(base)
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || !isConfigOverride(key)) continue
    const path = key.slice('VEODYN_'.length).toLowerCase().split('__')
    let node = out as Record<string, unknown>
    for (let i = 0; i < path.length - 1; i++) {
      const seg = path[i]
      if (typeof node[seg] !== 'object' || node[seg] === null) node[seg] = {}
      node = node[seg] as Record<string, unknown>
    }
    node[path[path.length - 1]] = coerceEnvValue(value)
  }
  return out
}

function loadConfig(): VeodynConfig {
  const merged = applyEnvOverrides(readConfigFile(CONFIG_PATH), process.env)
  const parsed = veodynConfigSchema.safeParse(merged)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`)
    throw new Error(`[config] invalid veodyn.config.yaml:\n${lines.join('\n')}`)
  }
  return parsed.data
}

// A tenant's brand palette is their call, so a failing one still ships. What we
// owe them is visibility: one structured warning at boot naming exactly which
// checks failed and on which pair, instead of a silently inaccessible chart.
//
// Both columns are checked. themeStyle() derives the dark column from the
// light one (hue held, lightness and chroma re-stepped into the dark band),
// but derivation only guarantees each color individually lands in band: it
// does not guarantee the derived pair stays separated. A light pair can pass
// every light check and still derive to a dark pair that fails CVD or
// normal-vision separation (verified: light `#6825AD,#2B64D0` passes light
// validation outright, but derives to `#7332BA,#2A64D2`, which fails both).
//
// Both columns are also validated at the same effective slot count the
// emitter actually renders (CHART_PALETTE_SIZE, cycle-filled or truncated),
// not the raw authored array: a one-color palette cycle-fills into 8
// identical adjacent slots, which is a real accessibility failure the raw
// one-entry array would never surface.
export function warnOnPaletteDefects(palette: string[]): void {
  const effective = effectivePalette(palette, CHART_PALETTE_SIZE)

  let lightReport
  try {
    lightReport = validatePalette(effective, { mode: 'light', surface: CHART_SURFACE_LIGHT })
  } catch (err) {
    console.warn(
      `[config] theme.chart_palette could not be validated: ${(err as Error).message}. Charts will render, but the palette was not checked for accessibility.`
    )
    return
  }

  // deriveDarkColumn never throws on a hex that already normalized cleanly
  // above (its "every step out of gamut" case falls back to a usable color
  // instead), so no separate try/catch is needed here.
  const darkReport = validatePalette(deriveDarkColumn(effective), {
    mode: 'dark',
    surface: CHART_SURFACE_DARK,
  })

  if (lightReport.ok && darkReport.ok) return

  const sections: string[] = []
  if (!lightReport.ok) {
    sections.push(`Light column (as configured):\n${formatReport(lightReport)}`)
  }
  if (!darkReport.ok) {
    sections.push(`Dark column (derived from theme.chart_palette):\n${formatReport(darkReport)}`)
  }

  console.warn(
    `[config] theme.chart_palette does not pass chart accessibility validation. Charts will still render with these colors.\n${sections.join('\n\n')}`
  )
}

export const config = loadConfig()
warnOnPaletteDefects(config.theme.chart_palette)
