// Pure font-role resolution. Maps a configured family name to the CSS variable
// the token layer reads (--font-display-family / --font-sans-family /
// --font-mono-family). The next/font instances themselves live in
// font-registry.ts (the compiler-macro boundary); this module takes the
// registry as a parameter so it stays unit-testable.
import type { CSSProperties } from 'react'

export type FontRole = 'display' | 'ui' | 'mono'

export type FontVarName =
  | '--font-display-family'
  | '--font-sans-family'
  | '--font-mono-family'

export const DEFAULT_FONT_FAMILIES: Record<FontRole, string> = {
  display: 'Newsreader',
  ui: 'Geist',
  mono: 'Geist Mono',
}

const ROLE_TO_VAR: Record<FontRole, FontVarName> = {
  display: '--font-display-family',
  ui: '--font-sans-family',
  mono: '--font-mono-family',
}

type FontRegistry = Record<string, { variable: string }>

function pick(
  role: FontRole,
  requested: string,
  registry: FontRegistry
): string {
  const family = registry[requested]
    ? requested
    : DEFAULT_FONT_FAMILIES[role]
  const entry = registry[family] ?? registry[DEFAULT_FONT_FAMILIES[role]]
  return `var(${entry.variable})`
}

export function resolveFontFamilyVars(
  fonts: { display: string; ui: string; mono: string },
  registry: FontRegistry
): Record<FontVarName, string> {
  return {
    [ROLE_TO_VAR.display]: pick('display', fonts.display, registry),
    [ROLE_TO_VAR.ui]: pick('ui', fonts.ui, registry),
    [ROLE_TO_VAR.mono]: pick('mono', fonts.mono, registry),
  } as Record<FontVarName, string>
}

export function fontStyleFrom(
  fonts: { display: string; ui: string; mono: string },
  registry: FontRegistry
): CSSProperties {
  return resolveFontFamilyVars(fonts, registry) as CSSProperties
}
