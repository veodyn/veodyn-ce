/**
 * Pausing a data source. One switch stops every query and alert behind it,
 * which is what you want when a feed goes bad: the alternative is disabling
 * schedules one query at a time while the dashboards keep serving nonsense.
 *
 * The endpoint is POST /data_sources/:id/pause with an optional reason, and
 * DELETE on the same path to resume (redash/handlers/data_sources.py:187).
 * The reason is not decoration: Redash shows it wherever the source appears,
 * so whoever finds the paused source learns why without asking.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { pauseDataSource, resumeDataSource } from './data-sources'

const post = vi.fn()
const del = vi.fn()

vi.mock('@/services/api-client', () => ({
  redashApi: {
    post: (path: string, data?: unknown) => post(path, data),
    delete: (path: string) => del(path),
    get: vi.fn(),
  },
  ApiError: class extends Error {},
}))

const SOURCE = { id: 3, name: 'ClickHouse', type: 'clickhouse', paused: 1 }

beforeEach(() => {
  post.mockReset()
  del.mockReset()
  post.mockResolvedValue(SOURCE)
  del.mockResolvedValue({ ...SOURCE, paused: 0 })
})

describe('pausing a data source', () => {
  it('posts to the pause endpoint with the reason', async () => {
    await pauseDataSource(3, 'Feed stalled')

    expect(post).toHaveBeenCalledWith('data_sources/3/pause', { reason: 'Feed stalled' })
  })

  // The reason is optional in the API, and an empty box should not become an
  // empty-string reason that renders as a blank explanation.
  it('omits the reason when none was given', async () => {
    await pauseDataSource(3, '')

    expect(post).toHaveBeenCalledWith('data_sources/3/pause', {})
  })

  it('returns the updated source', async () => {
    await expect(pauseDataSource(3, 'x')).resolves.toEqual(SOURCE)
  })
})

describe('resuming a data source', () => {
  it('deletes the pause rather than posting a flag', async () => {
    await resumeDataSource(3)

    expect(del).toHaveBeenCalledWith('data_sources/3/pause')
    expect(post).not.toHaveBeenCalled()
  })
})
