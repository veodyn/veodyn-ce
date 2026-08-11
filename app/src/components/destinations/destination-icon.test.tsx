import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { DestinationIcon } from '@/components/destinations/destination-icon'

// Every type the map covers: the two Redash enables by default
// (redash/settings/__init__.py default_destinations), plus `slack`, which is
// not one of them and arrives through REDASH_ADDITIONAL_DESTINATIONS. The map
// carrying a type this tree does not enable is the point rather than a leftover
// (see the component's own comment), so the list here is not the default set.
const ICON_TYPES = ['email', 'slack', 'webhook']

function glyphOf(type: string | undefined): string {
  const { container } = render(<DestinationIcon type={type} />)
  const svg = container.querySelector('svg')
  // lucide stamps the icon name into the class list, which is the only thing
  // that distinguishes one rendered glyph from another.
  return svg?.getAttribute('class') ?? ''
}

describe('destination icons', () => {
  it('gives every enabled type its own glyph', () => {
    const glyphs = ICON_TYPES.map(glyphOf)

    expect(glyphs.every((g) => g !== '')).toBe(true)
    // A grid of cards that all showed the same paper plane is exactly what
    // made this screen read as a stub.
    expect(new Set(glyphs).size).toBe(ICON_TYPES.length)
    expect(glyphs.filter((g) => g.includes('lucide-send'))).toEqual([])
  })

  it('falls back to the paper plane for a type it has never seen', () => {
    // The enabled list is server-side config, so an unknown type is not a bug.
    expect(glyphOf('carrier_pigeon')).toContain('lucide-send')
    expect(glyphOf(undefined)).toContain('lucide-send')
  })
})
