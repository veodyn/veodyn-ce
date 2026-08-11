// Data source reads, writes, and the two places this module swallows an error
// on purpose.
//
// Both swallows are worth pinning because they turn a thrown error into a
// value: a 404 becomes `null` so the detail page can say "no such source"
// instead of crashing, and a failed connection test becomes
// `{ok: false, message}` so the form can show why. Widen either one and a real
// failure (a 500, a network drop) disappears into the same quiet answer.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ApiError } from '@/services/api-client'
import {
  createDataSource,
  deleteDataSource,
  getDataSource,
  listDataSources,
  listTypes,
  testConnection,
  updateDataSource,
} from './data-sources'

const get = vi.fn()
const post = vi.fn()
const del = vi.fn()

// importOriginal keeps the real ApiError, so `instanceof` and `.status` behave
// exactly as they do in the app. A stand-in class would make the 404 branch
// look covered while testing nothing about how it is recognised.
vi.mock('@/services/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api-client')>()),
  redashApi: {
    get: (path: string, options?: unknown) => get(path, options),
    post: (path: string, data?: unknown) => post(path, data),
    delete: (path: string) => del(path),
  },
}))

const SOURCE = { id: 3, name: 'ClickHouse', type: 'clickhouse' }

beforeEach(() => {
  get.mockReset()
  post.mockReset()
  del.mockReset()
})

describe('data source reads', () => {
  it('lists the collection', async () => {
    get.mockResolvedValue([SOURCE])

    await expect(listDataSources()).resolves.toEqual([SOURCE])
    expect(get).toHaveBeenCalledWith('data_sources', undefined)
  })

  it('reads one source from its member path', async () => {
    get.mockResolvedValue(SOURCE)

    await expect(getDataSource(3)).resolves.toEqual(SOURCE)
    expect(get).toHaveBeenCalledWith('data_sources/3', undefined)
  })

  it('answers null for a source that does not exist', async () => {
    get.mockRejectedValue(new ApiError(404, 'Not found'))

    await expect(getDataSource(999)).resolves.toBeNull()
  })

  // A 403 is "you may not see this", a 500 is "the backend broke". Neither is
  // "there is no such source", and turning them into null would render the
  // empty state over a real problem.
  it('rethrows a failure that is not a 404', async () => {
    get.mockRejectedValue(new ApiError(403, 'Forbidden'))

    await expect(getDataSource(3)).rejects.toThrow('Forbidden')
  })

  it('rethrows a non-API failure such as a dropped connection', async () => {
    get.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(getDataSource(3)).rejects.toThrow('Failed to fetch')
  })

  it('lists the runner types from their own sub-path', async () => {
    get.mockResolvedValue([{ type: 'pg', name: 'PostgreSQL', configuration_schema: {} }])

    await expect(listTypes()).resolves.toHaveLength(1)
    expect(get).toHaveBeenCalledWith('data_sources/types', undefined)
  })
})

describe('data source writes', () => {
  it('posts a new source to the collection', async () => {
    post.mockResolvedValue(SOURCE)

    await createDataSource({ name: 'CH', type: 'clickhouse', options: { host: 'h' } })

    expect(post).toHaveBeenCalledWith('data_sources', {
      name: 'CH',
      type: 'clickhouse',
      options: { host: 'h' },
    })
  })

  // Redash updates with POST to the member path, not PUT.
  it('posts an update to the member path', async () => {
    post.mockResolvedValue(SOURCE)

    await updateDataSource(3, { name: 'Renamed' })

    expect(post).toHaveBeenCalledWith('data_sources/3', { name: 'Renamed' })
  })

  it('deletes the member path', async () => {
    del.mockResolvedValue(undefined)

    await deleteDataSource(3)

    expect(del).toHaveBeenCalledWith('data_sources/3')
  })
})

describe('testConnection', () => {
  it('posts to the source test sub-path', async () => {
    post.mockResolvedValue({})

    await testConnection(3)

    expect(post).toHaveBeenCalledWith('data_sources/3/test', undefined)
  })

  // Redash answers a passing test with a body that has no `ok` at all, so
  // absence has to read as success. Requiring `ok === true` would report every
  // healthy source as broken.
  it('reads a body without an ok field as a pass', async () => {
    post.mockResolvedValue({})

    await expect(testConnection(3)).resolves.toEqual({ ok: true, message: undefined })
  })

  it('reads an explicit ok:false as a failure and keeps the reason', async () => {
    post.mockResolvedValue({ ok: false, message: 'could not connect to host' })

    await expect(testConnection(3)).resolves.toEqual({
      ok: false,
      message: 'could not connect to host',
    })
  })

  it('turns a rejected request into a failed test with the API message', async () => {
    post.mockRejectedValue(new ApiError(400, 'Authentication failed'))

    await expect(testConnection(3)).resolves.toEqual({
      ok: false,
      message: 'Authentication failed',
    })
  })

  it('supplies a message when the API error carries none', async () => {
    post.mockRejectedValue(new ApiError(500, ''))

    await expect(testConnection(3)).resolves.toEqual({
      ok: false,
      message: 'Connection test failed',
    })
  })

  it('does not let a non-API failure escape as a thrown error', async () => {
    post.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(testConnection(3)).resolves.toEqual({
      ok: false,
      message: 'Connection test failed',
    })
  })
})
