// app/src/lib/config.palette-warning.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { warnOnPaletteDefects } from '@/lib/config'
import { DEFAULT_PALETTE } from '@/lib/config-schema'

afterEach(() => vi.restoreAllMocks())

describe('warnOnPaletteDefects', () => {
  it('says nothing for a palette that passes, light and derived dark', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // The full 8-entry default: an arbitrary 4-color subset of it does NOT
    // work as this fixture, because cycle-filling 4 colors to the effective
    // 8 slots introduces a wrap pair (slot 4 back to slot 1) that the
    // hand-picked 8-color sequence was never designed to clear. That is the
    // exact bug Finding 2 fixes: validating the raw short array blessed a
    // palette whose actual 8-slot rendering failed CVD separation at the wrap.
    warnOnPaletteDefects(DEFAULT_PALETTE)
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns once, naming the failed checks and the offending pair', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warnOnPaletteDefects(['#41569E', '#7A4E9E'])
    expect(warn).toHaveBeenCalledTimes(1)
    const message = warn.mock.calls[0].join(' ')
    expect(message).toContain('theme.chart_palette')
    expect(message).toContain('Light column')
    expect(message).toContain('CVD separation')
    expect(message).toContain('#7A4E9E')
  })

  it('does not throw or mutate: a failing palette still ships', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const palette = ['#41569E', '#7A4E9E']
    expect(() => warnOnPaletteDefects(palette)).not.toThrow()
    expect(palette).toEqual(['#41569E', '#7A4E9E'])
  })

  it('warns rather than throwing when a hex is malformed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => warnOnPaletteDefects(['not-a-hex'])).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  // Finding 1: a light pair can clear every light-mode check and still derive
  // to a dark pair that fails CVD and normal-vision separation, because
  // derivation only guarantees per-color lightness and chroma, not pair
  // separation. Before this fix, only the light column was ever checked here.
  it('warns on the derived dark column even when the light column passes outright', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warnOnPaletteDefects(['#6825AD', '#2B64D0'])
    expect(warn).toHaveBeenCalledTimes(1)
    const message = warn.mock.calls[0].join(' ')
    // The light column itself must be reported as fine, not folded into the
    // failure, so a tenant can tell which column needs attention.
    expect(message).not.toContain('Light column')
    expect(message).toContain('Dark column')
    expect(message).toContain('CVD separation')
    expect(message).toContain('#7332BA')
    expect(message).toContain('#2A64D2')
  })

  // Finding 2: a one-color palette cycle-fills into 8 identical adjacent
  // slots at render time. Validating the raw one-entry array (as before)
  // reported "single slot, no adjacent pair" and passed; validating the
  // effective 8-slot array correctly fails it.
  it('warns on a one-color palette instead of passing it as a single slot', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warnOnPaletteDefects(['#485EA7'])
    expect(warn).toHaveBeenCalledTimes(1)
    const message = warn.mock.calls[0].join(' ')
    expect(message).toContain('Light column')
    expect(message).toContain('CVD separation')
  })
})
