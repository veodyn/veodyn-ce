import { beforeEach, describe, expect, it, vi } from 'vitest'

const captureMock = vi.hoisted(() => ({
  capture: vi.fn(),
  currentRoute: () => '/feed-health',
}))
vi.mock('./capture', () => captureMock)

import { AppError, ErrorIds } from '@/lib/errorIds'
import { reportQueryError } from './querySeam'

beforeEach(() => vi.clearAllMocks())

describe('reportQueryError', () => {
  it('reports the first key segment and the status from an AppError', () => {
    reportQueryError(new AppError(ErrorIds.UP_BAD_STATUS, 'bad', { status: 502 }), ['feeds', 12])
    expect(captureMock.capture).toHaveBeenCalledWith('query_failed', {
      queryKey: 'feeds',
      errorId: 'E_UP_003',
      status: 502,
      route: '/feed-health',
    })
  })

  it('reports a plain error with no id and no status', () => {
    reportQueryError(new Error('network down'), ['dashboards'])
    expect(captureMock.capture).toHaveBeenCalledWith('query_failed', {
      queryKey: 'dashboards',
      errorId: '',
      status: 0,
      route: '/feed-health',
    })
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
