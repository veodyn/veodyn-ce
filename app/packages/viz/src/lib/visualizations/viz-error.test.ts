import { describe, expect, it } from 'vitest'
import { VizError, VIZ_ERROR_IDS } from './viz-error'

describe('VizError', () => {
  it('is an Error carrying a stable id and its context', () => {
    const error = new VizError(VIZ_ERROR_IDS.GEOJSON_FAILED, 'Failed to load map geometry', { status: 404 })

    expect(error).toBeInstanceOf(Error)
    expect(error.id).toBe('E_UI_002')
    expect(error.message).toBe('Failed to load map geometry')
    expect(error.context).toEqual({ status: 404 })
  })

  it('keeps the ids the app logged before the split', () => {
    expect(VIZ_ERROR_IDS).toEqual({ RENDER_FAILED: 'E_UI_001', GEOJSON_FAILED: 'E_UI_002' })
  })

  it('renders the same log line shape as the app error', () => {
    const error = new VizError(VIZ_ERROR_IDS.RENDER_FAILED, 'Visualization failed to render', { cause: 'boom' })

    expect(error.toLogLine()).toBe('[E_UI_001] Visualization failed to render cause="boom"')
  })
})
