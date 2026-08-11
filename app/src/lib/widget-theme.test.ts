import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WIDGET_THEME,
  isWidgetTheme,
  readWidgetTheme,
  resolveWidgetTheme,
  WIDGET_THEMES,
} from './widget-theme'

describe('readWidgetTheme', () => {
  it('reads a stored choice', () => {
    expect(readWidgetTheme({ theme: 'dark' })).toBe('dark')
  })

  // A visualization saved before this option existed has no `theme` key at all,
  // and it has to keep behaving exactly as it did rather than pinning itself to
  // whatever an absent value happens to coerce to.
  it.each([
    ['no key', {}],
    ['null options', null],
    ['undefined options', undefined],
    ['a non-object', 'dark'],
    ['an unknown value', { theme: 'midnight' }],
    ['a non-string', { theme: 1 }],
  ])('falls back to the default for %s', (_label, options) => {
    expect(readWidgetTheme(options)).toBe(DEFAULT_WIDGET_THEME)
  })

  it('defaults to following the reader', () => {
    expect(DEFAULT_WIDGET_THEME).toBe('auto')
  })
})

describe('resolveWidgetTheme', () => {
  it.each([
    ['auto', 'dark', 'dark'],
    ['auto', 'light', 'light'],
    ['dark', 'light', 'dark'],
    ['light', 'dark', 'light'],
  ] as const)('%s on a %s app renders %s', (widget, app, expected) => {
    expect(resolveWidgetTheme(widget, app)).toBe(expected)
  })
})

describe('isWidgetTheme', () => {
  it('accepts every value the menu offers', () => {
    for (const theme of WIDGET_THEMES) expect(isWidgetTheme(theme)).toBe(true)
  })

  it.each([['midnight'], [''], [null], [undefined], [0], [{}]])('rejects %s', (value) => {
    expect(isWidgetTheme(value)).toBe(false)
  })
})
