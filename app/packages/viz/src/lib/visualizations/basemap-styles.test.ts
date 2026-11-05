import { describe, expect, it } from 'vitest'
import { BASEMAP_DARK_STYLE, BASEMAP_LIGHT_STYLE } from '@veodyn/viz'
import * as styles from './basemap-styles'

describe('basemap styles', () => {
  it('exposes the Carto Positron light style', () => {
    expect(styles.BASEMAP_LIGHT_STYLE).toBe('https://basemaps.cartocdn.com/gl/positron-gl-style/style.json')
  })

  it('exposes the Carto Dark Matter dark style', () => {
    expect(styles.BASEMAP_DARK_STYLE).toBe('https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json')
  })

  it('resolves from the @veodyn/viz entry', () => {
    expect(BASEMAP_LIGHT_STYLE).toBe(styles.BASEMAP_LIGHT_STYLE)
    expect(BASEMAP_DARK_STYLE).toBe(styles.BASEMAP_DARK_STYLE)
  })
})
