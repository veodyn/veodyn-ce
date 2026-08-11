import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PALETTE, DEFAULT_PALETTE_DARK } from '@/lib/config-schema'

// Deliberately not `new URL('./globals.css', import.meta.url)`: Vite's
// import-analysis plugin statically rewrites that exact literal pattern (its
// static-asset-URL convention) into a dev-server-relative URL under the
// jsdom test environment, which then fails file reads with a scheme error
// unrelated to the assertions below.
// The palette moved into tokens.css when the pinned-light `.light` block pushed
// globals.css past the file-size limit. Both are read and concatenated, so these
// assertions keep describing "the stylesheet" rather than tracking which half a
// token currently lives in.
const here = dirname(fileURLToPath(import.meta.url))
const css = ['tokens.css', 'globals.css'].map((f) => readFileSync(join(here, f), 'utf8')).join('\n')

describe('globals.css Editorial Light light tokens', () => {
  it('sets the paper/ink canvas tokens', () => {
    expect(css).toContain('--background: #F7F5F0')
    expect(css).toContain('--foreground: #1C1B18')
    expect(css).toContain('--card: #FFFFFF')
    expect(css).toContain('--border: #E5E1D8')
  })

  it('defaults the accent to neutral slate so config injection overrides it', () => {
    expect(css).toContain('--primary: #475569')
    expect(css).toContain('--ring: #475569')
  })

  it('defines the semantic status pair (paired with icon/text at call sites)', () => {
    expect(css).toContain('--status-fresh: #2E7D4F')
    // Darkened from #C08A2D, which failed WCAG AA on both light surfaces (see
    // the contrast suite below).
    expect(css).toContain('--status-stale: #94671F')
  })

  it('removes the legacy tenant brand block', () => {
    expect(css).not.toContain('--color-brand-primary')
    expect(css).not.toContain('#2c5282')
    expect(css).not.toContain('#c41230')
  })
})

describe('globals.css dark scope (Wall/Present)', () => {
  it('sets the dark editorial canvas', () => {
    expect(css).toContain('--background: #0B0E14')
  })

  it('drops the purple legacy tenant dark values', () => {
    expect(css).not.toContain('#1a1a2e')
    expect(css).not.toContain('#232340')
  })

  it('redeclares chart vars in the dark block as its own column, so the stylesheet documents a real dark palette rather than dead placeholder values', () => {
    const darkBlock = css.match(/\.dark\s*{([^}]*)}/)
    expect(darkBlock).not.toBeNull()
    expect(darkBlock?.[1]).toContain('--chart-1')
  })
})

describe('globals.css chart tokens track the schema defaults', () => {
  it('declares the light column', () => {
    DEFAULT_PALETTE.forEach((hex, i) => {
      expect(css).toContain(`--chart-${i + 1}: ${hex};`)
    })
  })

  it('declares the dark column', () => {
    const dark = css.slice(css.indexOf('.dark {'))
    DEFAULT_PALETTE_DARK.forEach((hex, i) => {
      expect(dark).toContain(`--chart-${i + 1}: ${hex};`)
    })
  })
})

// Status text is real 12px-and-up copy (the at-risk badge, the stale scorecard
// line), so it has to clear WCAG 2.1 AA for normal text: 4.5:1. Computed here
// from the shipped hex tokens so a palette tweak cannot quietly drop below it.
const lightTokens = (() => {
  // The selector is a list, not a bare `:root`: the light tokens are shared with
  // `.light`, which is what lets a widget pinned light undo an ancestor `.dark`.
  // Matching only `:root {` silently found no block and threw, which is the
  // right failure but for the wrong reason, so the selector part is matched
  // loosely and the block is still identified by what it declares.
  const block = css
    .match(/:root[^{]*{([^}]*)}/g)
    ?.find((b) => b.includes('--status-stale'))
  if (!block) throw new Error('no :root block declaring --status-stale')
  return Object.fromEntries(
    [...block.matchAll(/(--[a-z-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]])
  )
})()

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('globals.css light status token contrast (WCAG AA, normal text)', () => {
  it.each(['--status-fresh', '--status-stale'])(
    '%s clears 4.5:1 against both light surfaces',
    (token) => {
      const value = lightTokens[token]
      expect(value).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(contrastRatio(value, lightTokens['--card'])).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(value, lightTokens['--background'])).toBeGreaterThanOrEqual(4.5)
    }
  )
})

describe('globals.css motion tokens', () => {
  it('defines motion duration tokens', () => {
    expect(css).toContain('--motion-duration-base:')
  })

  it('degrades motion under prefers-reduced-motion', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })
})

describe('globals.css report print scope', () => {
  it('applies print rules only when the report print root is present', () => {
    const printBlock = css.match(/@media print\s*{([\s\S]*)}\s*$/)

    expect(printBlock).not.toBeNull()
    expect(printBlock?.[1]).toContain('body:has([data-print-root])')
    expect(printBlock?.[1]).toContain('body:has([data-print-root]) .no-print')
    expect(printBlock?.[1]).toContain('[data-print-root]')
    expect(printBlock?.[1]).not.toMatch(/(?:^|})\s*\.no-print\s*{/)
  })
})
