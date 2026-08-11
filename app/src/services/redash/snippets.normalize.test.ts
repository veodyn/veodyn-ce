// What survives normalizeSnippet, and what each snippet call sends.
//
// The normalizer rebuilds the row field by field, so anything it does not name
// is gone before the snippets screen sees it. The two fields that carry a
// default are the ones worth pinning: `description` and `user`. A snippet
// created through Redash's own UI can come back with a null description, and
// the author is what the list column shows, so a dropped `user` renders every
// row as belonging to nobody.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { create, list, remove, update } from './snippets'

const get = vi.fn()
const post = vi.fn()
const del = vi.fn()

vi.mock('@/services/api-client', () => ({
  redashApi: {
    get: (path: string, options?: unknown) => get(path, options),
    post: (path: string, data?: unknown) => post(path, data),
    delete: (path: string) => del(path),
  },
  ApiError: class extends Error {},
}))

const RAW = {
  id: 5,
  trigger: 'last7d',
  description: 'Filter for last 7 days',
  snippet: "WHERE created_at >= NOW() - INTERVAL '7 days'",
  user: { id: 2, name: 'Author' },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
}

beforeEach(() => {
  get.mockReset()
  post.mockReset()
  del.mockReset()
})

describe('snippets.list', () => {
  it('reads the query_snippets collection', async () => {
    get.mockResolvedValue([])

    await list()

    expect(get).toHaveBeenCalledWith('query_snippets', undefined)
  })

  it('keeps every field the payload carries', async () => {
    get.mockResolvedValue([RAW])

    await expect(list()).resolves.toEqual([RAW])
  })

  it('keeps the author so the list can say who wrote the snippet', async () => {
    get.mockResolvedValue([RAW])

    const [snippet] = await list()

    expect(snippet.user).toEqual({ id: 2, name: 'Author' })
  })

  // A null description is what Redash stores for a snippet saved with the box
  // empty. Passing it through would put the string "null" in a table cell.
  it('turns a missing description into an empty string, not null', async () => {
    get.mockResolvedValue([{ ...RAW, description: null }])

    const [snippet] = await list()

    expect(snippet.description).toBe('')
  })

  it('stands in an anonymous author rather than leaving user undefined', async () => {
    get.mockResolvedValue([{ ...RAW, user: undefined }])

    const [snippet] = await list()

    // The type promises a user, so every consumer reads `user.name` without a
    // guard; undefined here is a crash in the list, not a blank cell.
    expect(snippet.user).toEqual({ id: 0, name: '' })
  })

  it('normalizes every row, not just the first', async () => {
    get.mockResolvedValue([
      { ...RAW, id: 1, description: null },
      { ...RAW, id: 2, description: null },
    ])

    const snippets = await list()

    expect(snippets.map((s) => s.description)).toEqual(['', ''])
  })
})

describe('snippets.create', () => {
  it('posts the new snippet to the collection', async () => {
    post.mockResolvedValue(RAW)

    await create({ trigger: 'x', description: 'd', snippet: 's' })

    expect(post).toHaveBeenCalledWith('query_snippets', {
      trigger: 'x',
      description: 'd',
      snippet: 's',
    })
  })

  it('normalizes the created row rather than returning the raw body', async () => {
    post.mockResolvedValue({ ...RAW, description: null, user: undefined })

    await expect(create({ trigger: 'x', description: '', snippet: 's' })).resolves.toMatchObject({
      description: '',
      user: { id: 0, name: '' },
    })
  })
})

describe('snippets.update', () => {
  // Redash updates a snippet with POST to the member path, not PUT.
  it('posts the changes to the member path', async () => {
    post.mockResolvedValue(RAW)

    await update(5, { snippet: 'SELECT 2' })

    expect(post).toHaveBeenCalledWith('query_snippets/5', { snippet: 'SELECT 2' })
  })

  it('normalizes the updated row', async () => {
    post.mockResolvedValue({ ...RAW, description: null })

    await expect(update(5, { trigger: 't' })).resolves.toMatchObject({ description: '' })
  })
})

describe('snippets.remove', () => {
  it('deletes the member path', async () => {
    del.mockResolvedValue(undefined)

    await remove(5)

    expect(del).toHaveBeenCalledWith('query_snippets/5')
    expect(post).not.toHaveBeenCalled()
  })
})
