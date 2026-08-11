import { describe, expect, it } from 'vitest'
import { hierarchy, partition } from 'd3-hierarchy'
import { arc } from 'd3-shape'
import cloud from 'd3-cloud'

describe('viz dependencies are installed and callable', () => {
  it('exposes d3-hierarchy hierarchy() and partition()', () => {
    expect(typeof hierarchy).toBe('function')
    expect(typeof partition).toBe('function')
  })

  it('exposes d3-shape arc()', () => {
    expect(typeof arc).toBe('function')
  })

  it('exposes the d3-cloud layout factory', () => {
    expect(typeof cloud).toBe('function')
  })
})
