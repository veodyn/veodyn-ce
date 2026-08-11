// The annotations contract, including the flag that decides whether the UI is
// allowed to offer it at all.
//
// There is no annotations resource in upstream Redash, so every write against a
// real backend answers 405. The dashboard shipped a full annotation surface
// against that absent backend and nothing said so, which is why the support
// flag is derived from the mode rather than declared: a separate config value
// could disagree with reality, and "saved" would go back to looking identical
// to "silently discarded".
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { create, list, remove } from './annotations'

const get = vi.fn()
const post = vi.fn()
const del = vi.fn()

vi.mock('@/services/api-client', () => ({
  redashApi: {
    get: (path: string, options?: unknown) => get(path, options),
    post: (path: string, data?: unknown, options?: unknown) => post(path, data, options),
    delete: (path: string, options?: unknown) => del(path, options),
  },
  ApiError: class extends Error {},
}))

const ANNOTATION = {
  id: 1,
  dashboard_id: 4,
  widget_id: null,
  start: '2026-01-01T00:00:00Z',
  end: null,
  label: 'Sensor swap',
  source: 'manual',
  created_at: '2026-01-01T00:00:00Z',
}

beforeEach(() => {
  get.mockReset()
  post.mockReset()
  del.mockReset()
  get.mockResolvedValue([ANNOTATION])
  post.mockResolvedValue(ANNOTATION)
  del.mockResolvedValue(undefined)
})

describe('annotations.list', () => {
  // Scoped by dashboard, not filtered client-side: an unscoped read would put
  // one dashboard's annotations on every other dashboard's charts.
  it('scopes the read to one dashboard', async () => {
    await list(4)

    expect(get).toHaveBeenCalledWith('annotations', {
      params: { dashboard_id: 4 },
      signal: undefined,
    })
  })

  it('threads the caller signal so a dashboard switch cancels the read', async () => {
    const controller = new AbortController()

    await list(4, { signal: controller.signal })

    expect(get.mock.calls[0][1]).toEqual({
      params: { dashboard_id: 4 },
      signal: controller.signal,
    })
  })

  it('returns what the backend sent', async () => {
    await expect(list(4)).resolves.toEqual([ANNOTATION])
  })
})

describe('annotations.create', () => {
  it('posts the whole annotation to the collection', async () => {
    const input = {
      dashboard_id: 4,
      widget_id: 9,
      start: '2026-01-01T00:00:00Z',
      end: null,
      label: 'Sensor swap',
      source: 'manual',
    }

    await create(input)

    expect(post).toHaveBeenCalledWith('annotations', input, { signal: undefined })
  })

  it('threads the caller signal', async () => {
    const controller = new AbortController()

    await create(
      {
        dashboard_id: 4,
        widget_id: null,
        start: '2026-01-01T00:00:00Z',
        end: null,
        label: 'x',
        source: 'manual',
      },
      { signal: controller.signal }
    )

    expect(post.mock.calls[0][2]).toEqual({ signal: controller.signal })
  })
})

describe('annotations.remove', () => {
  it('deletes the member path', async () => {
    await remove(7)

    expect(del).toHaveBeenCalledWith('annotations/7', { signal: undefined })
  })

  it('threads the caller signal', async () => {
    const controller = new AbortController()

    await remove(7, { signal: controller.signal })

    expect(del).toHaveBeenCalledWith('annotations/7', { signal: controller.signal })
  })
})

describe('ANNOTATIONS_SUPPORTED', () => {
  afterEach(() => {
    vi.doUnmock('@/services/redash/config')
    vi.resetModules()
  })

  async function supportedWhenRealApiIs(useRealApi: boolean): Promise<boolean> {
    vi.resetModules()
    vi.doMock('@/services/redash/config', () => ({ USE_REAL_API: useRealApi }))
    const mod = await import('./annotations')
    return mod.ANNOTATIONS_SUPPORTED
  }

  it('is on in mock mode, where the store answers every call', async () => {
    await expect(supportedWhenRealApiIs(false)).resolves.toBe(true)
  })

  // The one that matters. Against a real Redash there is no resource to answer
  // any of these, so the entry point gated on this flag has to disappear.
  it('is off against a real Redash, which has no annotations resource', async () => {
    await expect(supportedWhenRealApiIs(true)).resolves.toBe(false)
  })
})
