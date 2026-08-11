// next/font boundary. next/font is a build-time compiler macro (it does not run
// under Vitest), so this module is intentionally not unit-tested; the pure
// resolution logic it delegates to lives in fonts.ts and is tested there.
//
// `source: bundled` seam: an air-gapped operator drops self-hosted files and
// adds a next/font/local entry to FONT_REGISTRY under the same family name. The
// resolver in fonts.ts is source-agnostic (it only maps names to variables), so
// no resolver change is needed to support bundled fonts.
import { Newsreader, Geist, Geist_Mono } from 'next/font/google'
import type { CSSProperties } from 'react'
import { fontStyleFrom } from '@/lib/fonts'
import type { ClientConfig } from '@/lib/config-schema'

const newsreader = Newsreader({
  subsets: ['latin'],
  variable: '--font-newsreader',
  display: 'swap',
})
const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
  display: 'swap',
})
const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
})

export const FONT_REGISTRY: Record<string, { variable: string }> = {
  Newsreader: { variable: '--font-newsreader' },
  Geist: { variable: '--font-geist' },
  'Geist Mono': { variable: '--font-geist-mono' },
}

// Every allow-listed family's .variable class, so each --font-<family> var is
// defined on <html>; fontStyleFromConfig then points the role vars at the
// chosen ones.
export const appFontClassName = [
  newsreader.variable,
  geist.variable,
  geistMono.variable,
].join(' ')

export function fontStyleFromConfig(
  fonts: ClientConfig['theme']['fonts']
): CSSProperties {
  return fontStyleFrom(
    { display: fonts.display, ui: fonts.ui, mono: fonts.mono },
    FONT_REGISTRY
  )
}
