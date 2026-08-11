// What each users call puts on the wire.
//
// Two things here are easy to get subtly wrong and hard to notice. The list
// filters are separate boolean params, not one `filter=` value, so a wrong name
// returns the default (active) list and the Disabled tab silently shows active
// users. And update sends `group_ids`, not `groups`: Redash ignores an unknown
// key, so a group change appears to save and simply does not.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ApiError } from '@/services/api-client'
import { create, disable, enable, get as getUser, list, update } from './users'

const get = vi.fn()
const post = vi.fn()
const del = vi.fn()

vi.mock('@/services/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api-client')>()),
  redashApi: {
    get: (path: string, options?: unknown) => get(path, options),
    post: (path: string, data?: unknown) => post(path, data),
    delete: (path: string) => del(path),
  },
}))

const RAW = { id: 4, name: 'Ada', email: 'ada@example.com', groups: [1] }

beforeEach(() => {
  get.mockReset()
  post.mockReset()
  del.mockReset()
  get.mockResolvedValue({ count: 1, page: 1, page_size: 250, results: [RAW] })
  post.mockResolvedValue(RAW)
  del.mockResolvedValue(undefined)
})

function paramsOfLastGet(): Record<string, unknown> {
  return (get.mock.calls.at(-1)?.[1] as { params: Record<string, unknown> }).params
}

describe('users.list', () => {
  // The users screen has no pager, so a page size that is too small hides
  // people rather than paginating them.
  it('reads one large page instead of the backend default', async () => {
    await list()

    expect(get.mock.calls[0][0]).toBe('users')
    expect(paramsOfLastGet()).toEqual({ page: 1, page_size: 250 })
  })

  it('asks for disabled users with the disabled flag', async () => {
    await list('disabled')

    expect(paramsOfLastGet()).toEqual({ page: 1, page_size: 250, disabled: true })
  })

  it('asks for pending invitations with the pending flag', async () => {
    await list('pending')

    expect(paramsOfLastGet()).toEqual({ page: 1, page_size: 250, pending: true })
  })

  // Active is the backend's own default, so it must send NEITHER flag. Sending
  // `disabled: false` would be a different query on some Redash versions.
  it('sends no filter flag for the active list', async () => {
    await list('active')

    expect(paramsOfLastGet()).toEqual({ page: 1, page_size: 250 })
  })

  it('keeps the backend count and normalizes every row', async () => {
    get.mockResolvedValue({
      count: 2,
      page: 1,
      page_size: 250,
      results: [RAW, { ...RAW, id: 5, groups: [{ id: 3 }] }],
    })

    const page = await list()

    expect(page.count).toBe(2)
    expect(page.results.map((u) => u.groups)).toEqual([[1], [3]])
  })
})

describe('users.get', () => {
  it('reads the member path and normalizes the row', async () => {
    get.mockResolvedValue(RAW)

    await expect(getUser(4)).resolves.toMatchObject({ id: 4, auth_type: 'password' })
    expect(get).toHaveBeenCalledWith('users/4', undefined)
  })

  it('answers null for a user that does not exist', async () => {
    get.mockRejectedValue(new ApiError(404, 'Not found'))

    await expect(getUser(999)).resolves.toBeNull()
  })

  it('rethrows anything that is not a 404', async () => {
    get.mockRejectedValue(new ApiError(403, 'Forbidden'))

    await expect(getUser(4)).rejects.toThrow('Forbidden')
  })
})

describe('users.create', () => {
  it('posts the new user to the collection', async () => {
    await create({ name: 'Ada', email: 'ada@example.com' })

    expect(post).toHaveBeenCalledWith('users', { name: 'Ada', email: 'ada@example.com' })
  })

  it('surfaces the invite link a mail-less install returns', async () => {
    post.mockResolvedValue({ ...RAW, invite_link: 'https://r/invite/abc' })

    await expect(create({ name: 'Ada', email: 'ada@example.com' })).resolves.toMatchObject({
      invite_link: 'https://r/invite/abc',
    })
  })
})

describe('users.update', () => {
  it('renames groups to the group_ids key Redash reads', async () => {
    await update(4, { groups: [1, 2] })

    expect(post).toHaveBeenCalledWith('users/4', { group_ids: [1, 2] })
  })

  it('sends only the fields the caller changed', async () => {
    await update(4, { name: 'Ada L' })

    expect(post).toHaveBeenCalledWith('users/4', { name: 'Ada L' })
  })

  it('sends both name and email when both changed', async () => {
    await update(4, { name: 'Ada L', email: 'ada.l@example.com' })

    expect(post).toHaveBeenCalledWith('users/4', { name: 'Ada L', email: 'ada.l@example.com' })
  })

  // Clearing every group is a real edit, and an empty array must not be
  // mistaken for "no change to groups".
  it('sends an empty group list rather than dropping the key', async () => {
    await update(4, { groups: [] })

    expect(post).toHaveBeenCalledWith('users/4', { group_ids: [] })
  })

  // The whitelist is what stops a whole MockUser object (api_key, is_disabled,
  // created_at) being posted back at the backend.
  it('drops fields that are not the caller business to set', async () => {
    await update(4, { name: 'Ada', api_key: 'stolen', is_disabled: true, id: 99 })

    expect(post).toHaveBeenCalledWith('users/4', { name: 'Ada' })
  })

  it('normalizes the row it gets back', async () => {
    post.mockResolvedValue({ ...RAW, groups: [{ id: 9 }] })

    await expect(update(4, { name: 'Ada' })).resolves.toMatchObject({ groups: [9] })
  })
})

describe('disabling and re-enabling a user', () => {
  it('posts to the disable sub-path', async () => {
    await disable(4)

    expect(post).toHaveBeenCalledWith('users/4/disable', undefined)
  })

  // Enabling is a DELETE of the disable, not a flag on the user.
  it('deletes the disable rather than posting a flag', async () => {
    await enable(4)

    expect(del).toHaveBeenCalledWith('users/4/disable')
    expect(post).not.toHaveBeenCalled()
  })
})
