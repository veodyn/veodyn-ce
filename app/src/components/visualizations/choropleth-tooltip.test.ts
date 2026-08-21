import { describe, expect, it } from 'vitest'
import { choroplethTooltipText } from './choropleth-tooltip'

describe('choroplethTooltipText', () => {
  it('reads the region label and its value off the feature properties', () => {
    expect(choroplethTooltipText({ __key: 'North', __value: 42 })).toBe('North: 42')
  })

  it('says a region has no value rather than showing an empty one', () => {
    expect(choroplethTooltipText({ __key: 'North', __value: null })).toBe('North: no value')
  })

  it('shows the value alone when there is no label', () => {
    expect(choroplethTooltipText({ __key: null, __value: 42 })).toBe('42')
    expect(choroplethTooltipText({ __value: 42 })).toBe('42')
  })

  it('returns nothing when there is neither, so no popup is worth showing', () => {
    expect(choroplethTooltipText({ __key: null, __value: null })).toBe('')
    expect(choroplethTooltipText({})).toBe('')
    expect(choroplethTooltipText(null)).toBe('')
    expect(choroplethTooltipText(undefined)).toBe('')
  })

  // MapLibre round-trips feature properties through its own serialization, so
  // a number can arrive back as a string.
  it('accepts a value that came back as a string', () => {
    expect(choroplethTooltipText({ __key: 'North', __value: '42' })).toBe('North: 42')
  })

  it('accepts a label that is not a string', () => {
    expect(choroplethTooltipText({ __key: 7, __value: 1 })).toBe('7: 1')
  })

  // The text is rendered as a React text child, so markup in a region name is
  // shown, not interpreted. Asserting the string is carried through verbatim is
  // what pins that: any escaping or stripping here would mean somebody had
  // started treating it as markup.
  it('carries markup in a region name through as plain text', () => {
    expect(choroplethTooltipText({ __key: '<img src=x onerror=alert(1)>', __value: 1 })).toBe(
      '<img src=x onerror=alert(1)>: 1'
    )
  })
})
