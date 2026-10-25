import { describe, expect, it } from 'vitest'
import { PLUGIN_API_VERSION, registerVisualization } from '@veodyn/viz'
import { getDefaultSize } from './add-widget-layout'

const TALL_BOARD = 'TEST_TALL_DEPARTURE_BOARD'
const PLAIN_PLUGIN = 'TEST_PLAIN_PLUGIN'

function register(type: string, extra: Record<string, unknown> = {}) {
  registerVisualization({
    apiVersion: PLUGIN_API_VERSION,
    type,
    displayName: type,
    icon: () => null,
    defaultOptions: {},
    Renderer: () => null,
    ...extra,
  })
}

register(TALL_BOARD, { defaultSize: { sizeX: 3, sizeY: 12 } })
register(PLAIN_PLUGIN)

describe('the size a new widget starts at', () => {
  it('is the size a plugin visualization declares for itself', () => {
    expect(getDefaultSize(TALL_BOARD)).toEqual({ sizeX: 3, sizeY: 12 })
  })

  it('falls back to the generic size for a plugin that declares none', () => {
    expect(getDefaultSize(PLAIN_PLUGIN)).toEqual({ sizeX: 3, sizeY: 6 })
  })

  it('keeps the sizes of the core types and of an unknown type', () => {
    expect(getDefaultSize('TABLE')).toEqual({ sizeX: 3, sizeY: 8 })
    expect(getDefaultSize('MAP')).toEqual({ sizeX: 3, sizeY: 10 })
    expect(getDefaultSize('NOT_REGISTERED')).toEqual({ sizeX: 3, sizeY: 6 })
  })
})
