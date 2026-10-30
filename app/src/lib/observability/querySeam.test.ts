import { beforeEach, describe, expect, it, vi } from 'vitest'

const captureMock = vi.hoisted(() => ({
  capture: vi.fn(),
  currentRoute: () => '/captures',
}))
vi.mock('./capture', () => captureMock)

import { AppError, ErrorIds } from '@/lib/errorIds'
import { VizError, VIZ_ERROR_IDS } from '@veodyn/viz/lib/visualizations/viz-error'
import { ApiError } from '@/services/api-client'
import { reportQueryError } from './querySeam'

beforeEach(() => vi.clearAllMocks())

describe('reportQueryError', () => {
  it('reports the first key segment and the status from an AppError', () => {
    reportQueryError(new AppError(ErrorIds.UP_BAD_STATUS, 'bad', { status: 502 }), ['feeds', 12])
    expect(captureMock.capture).toHaveBeenCalledWith('query_failed', {
      queryKey: 'feeds',
      errorId: 'E_UP_003',
      status: 502,
      errorName: 'AppError',
      route: '/captures',
    })
  })

  it('reports the id and status of a failure raised inside the visualization package', () => {
    reportQueryError(new VizError(VIZ_ERROR_IDS.GEOJSON_FAILED, 'Failed to load map geometry', { status: 404 }), [
      'viz-geojson',
    ])
    expect(captureMock.capture).toHaveBeenCalledWith('query_failed', {
      queryKey: 'viz-geojson',
      errorId: 'E_UI_002',
      status: 404,
      errorName: 'VizError',
      route: '/captures',
    })
  })

  it('reports a plain error with no id and no status, naming its class', () => {
    reportQueryError(new TypeError('Failed to fetch'), ['dashboards'])
    expect(captureMock.capture).toHaveBeenCalledWith('query_failed', {
      queryKey: 'dashboards',
      errorId: '',
      status: 0,
      errorName: 'TypeError',
      route: '/captures',
    })
  })

  it('reports the HTTP status of a failed node API call', () => {
    reportQueryError(new ApiError(403, 'Forbidden'), ['org-settings'])
    expect(captureMock.capture).toHaveBeenCalledWith('query_failed', {
      queryKey: 'org-settings',
      errorId: '',
      status: 403,
      errorName: 'ApiError',
      route: '/captures',
    })
  })

  it('names a thrown value that is not an error without sending it', () => {
    reportQueryError('secret text', ['dashboards'])
    expect(captureMock.capture).toHaveBeenCalledWith(
      'query_failed',
      expect.objectContaining({ errorName: 'unknown', status: 0 }),
    )
  })

  it('never sends a key segment that is not a string, since it may carry a search term', () => {
    reportQueryError(new Error('x'), [{ search: 'acme revenue' }])
    expect(captureMock.capture).toHaveBeenCalledWith(
      'query_failed',
      expect.objectContaining({ queryKey: 'unknown' }),
    )
  })

  it('tolerates an empty query key', () => {
    reportQueryError(new Error('x'), [])
    expect(captureMock.capture).toHaveBeenCalledWith(
      'query_failed',
      expect.objectContaining({ queryKey: 'unknown' }),
    )
  })
})
