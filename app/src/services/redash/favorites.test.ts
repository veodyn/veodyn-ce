// Favoriting picks the HTTP verb from the state the caller already holds, so
// there is no GET to tell it which way to go. That makes the mapping the whole
// behaviour: post to add, delete to remove. Getting it backwards is a star that
// toggles in the UI and never changes on the server, which the optimistic
// update hides until a reload.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { setFavorite } from './favorites'

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

beforeEach(() => {
  post.mockReset()
  del.mockReset()
  post.mockResolvedValue(undefined)
  del.mockResolvedValue(undefined)
})

describe('setFavorite', () => {
  it('posts to add a query favorite', async () => {
    await setFavorite('queries', 12, true)

    expect(post).toHaveBeenCalledWith('queries/12/favorite', undefined)
    expect(del).not.toHaveBeenCalled()
  })

  it('deletes to remove a query favorite', async () => {
    await setFavorite('queries', 12, false)

    expect(del).toHaveBeenCalledWith('queries/12/favorite')
    expect(post).not.toHaveBeenCalled()
  })

  // The resource segment is the caller's word, and dashboards and queries have
  // separate favorite collections in Redash. Starring dashboard 3 must not
  // reach queries/3.
  it('addresses the dashboards collection when asked for a dashboard', async () => {
    await setFavorite('dashboards', 3, true)

    expect(post).toHaveBeenCalledWith('dashboards/3/favorite', undefined)
  })

  it('deletes the dashboards collection when unstarring a dashboard', async () => {
    await setFavorite('dashboards', 3, false)

    expect(del).toHaveBeenCalledWith('dashboards/3/favorite')
  })

  // The caller awaits this before it settles its optimistic update, so a
  // rejection has to reach it rather than being swallowed into a resolved
  // promise that leaves the star lying.
  it('lets a failure reach the caller', async () => {
    post.mockRejectedValue(new Error('403'))

    await expect(setFavorite('queries', 12, true)).rejects.toThrow('403')
  })
})
