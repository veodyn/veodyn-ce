import { describe, expect, it } from 'vitest'
import * as viz from './index'

describe('the @veodyn/viz entry', () => {
  it('exposes the host surface', () => {
    for (const name of ['VeodynProvider', 'VeodynViz', 'VisualizationRenderer', 'registerPlugins', 'registerVisualization', 'useVizEnvironment']) {
      expect(viz, name).toHaveProperty(name)
    }
  })

  it('exposes no editor', () => {
    expect(Object.keys(viz).filter((name) => /Editor/.test(name))).toEqual([])
  })
})
