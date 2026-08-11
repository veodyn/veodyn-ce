// Visualization CRUD and the share token that turns one into a public embed.
//
// Two contracts worth pinning. Updates are POST to /visualizations/:id, not
// PUT, and Redash answers a PUT with 405 rather than anything a user would
// read as "your chart did not save". And the share body carries `expires_at`
// only when there is one: sending `expires_at: null` is a different request
// from omitting the key, and every link minted before expiry existed has no
// expiry at all, which has to stay expressible.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  createVisualization,
  deleteVisualization,
  shareVisualization,
  unshareVisualization,
  updateVisualization,
} from './visualizations'

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

const VIZ = {
  id: 90,
  type: 'CHART',
  name: 'Temperature',
  description: '',
  options: { globalSeriesType: 'line' },
  created_at: '',
  updated_at: '',
}

beforeEach(() => {
  post.mockReset()
  del.mockReset()
  post.mockResolvedValue(VIZ)
  del.mockResolvedValue(undefined)
})

describe('createVisualization', () => {
  it('posts the whole definition to the collection', async () => {
    const data = {
      query_id: 12,
      type: 'CHART',
      name: 'Temperature',
      description: 'degrees',
      options: { globalSeriesType: 'line' },
    }

    await createVisualization(data)

    expect(post).toHaveBeenCalledWith('visualizations', data)
  })

  // This app already stores Redash-native types, so options cross this
  // boundary untranslated. A helpful reshaping here would silently change what
  // every existing chart draws.
  it('passes the options blob through without reshaping it', async () => {
    const options = { globalSeriesType: 'column', seriesOptions: { a: { color: '#123456' } } }

    await createVisualization({ query_id: 12, type: 'CHART', name: 'x', options })

    expect((post.mock.calls[0][1] as { options: unknown }).options).toBe(options)
  })

  it('returns the visualization the backend created', async () => {
    await expect(
      createVisualization({ query_id: 12, type: 'CHART', name: 'x', options: {} })
    ).resolves.toEqual(VIZ)
  })
})

describe('updateVisualization', () => {
  it('posts to the member path rather than putting to it', async () => {
    await updateVisualization(90, { name: 'Renamed' })

    expect(post).toHaveBeenCalledWith('visualizations/90', { name: 'Renamed' })
  })

  it('sends only the changed keys', async () => {
    await updateVisualization(90, { options: { globalSeriesType: 'area' } })

    expect(post).toHaveBeenCalledWith('visualizations/90', {
      options: { globalSeriesType: 'area' },
    })
  })

  it('can change the chart type and its options together', async () => {
    await updateVisualization(90, { type: 'COUNTER', options: { counterColName: 'v' } })

    expect(post).toHaveBeenCalledWith('visualizations/90', {
      type: 'COUNTER',
      options: { counterColName: 'v' },
    })
  })
})

describe('deleteVisualization', () => {
  it('deletes the member path', async () => {
    await deleteVisualization(90)

    expect(del).toHaveBeenCalledWith('visualizations/90')
    expect(post).not.toHaveBeenCalled()
  })
})

describe('shareVisualization', () => {
  it('posts to the share sub-resource', async () => {
    post.mockResolvedValue({ public_url: 'https://redash/embed/x', api_key: 'tok' })

    await shareVisualization(90)

    expect(post.mock.calls[0][0]).toBe('visualizations/90/share')
  })

  // No expiry is the historical default and has to stay expressible as an
  // absent key, not as a null the backend may read as a date it cannot parse.
  it('sends an empty body when the link should not expire', async () => {
    post.mockResolvedValue({ public_url: '', api_key: 'tok' })

    await shareVisualization(90)

    expect(post).toHaveBeenCalledWith('visualizations/90/share', {})
  })

  it('treats an explicit null expiry as no expiry', async () => {
    post.mockResolvedValue({ public_url: '', api_key: 'tok' })

    await shareVisualization(90, null)

    expect(post).toHaveBeenCalledWith('visualizations/90/share', {})
  })

  it('sends the expiry instant when the caller set one', async () => {
    post.mockResolvedValue({ public_url: '', api_key: 'tok' })

    await shareVisualization(90, '2026-12-31T23:59:59Z')

    expect(post).toHaveBeenCalledWith('visualizations/90/share', {
      expires_at: '2026-12-31T23:59:59Z',
    })
  })

  // api_key is the token this app builds its own /embed/public/<token> URL
  // from; public_url points at the Redash origin and is not what a reader gets.
  it('returns the token the app builds its own embed URL from', async () => {
    post.mockResolvedValue({ public_url: 'https://redash/embed/x', api_key: 'tok-123' })

    await expect(shareVisualization(90)).resolves.toEqual({
      public_url: 'https://redash/embed/x',
      api_key: 'tok-123',
    })
  })
})

describe('unshareVisualization', () => {
  // Revoking is a DELETE of the share, so the token stops working; posting an
  // empty share would mint a new one instead.
  it('deletes the share sub-resource', async () => {
    await unshareVisualization(90)

    expect(del).toHaveBeenCalledWith('visualizations/90/share')
    expect(post).not.toHaveBeenCalled()
  })
})
