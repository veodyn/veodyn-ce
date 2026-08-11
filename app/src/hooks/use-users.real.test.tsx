// The user hooks against a real backend: what reaches the service, what a
// refused read looks like, and which cached reads each write repairs.
//
// Invalidation is observed through the hooks' OWN queries rather than through a
// spy on `invalidateQueries`, so an implementation that invalidates the wrong
// key fails here instead of passing. The list and the detail entry are both
// mounted and both counted, because the interesting part is which of the two a
// given mutation heals.
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))
vi.mock('@/services/redash/users', () => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  disable: vi.fn(),
  enable: vi.fn(),
}))

import type { MockUser } from '@/lib/mock-data'
import * as usersService from '@/services/redash/users'
import {
  useCreateUser,
  useDisableUser,
  useEnableUser,
  useUpdateUser,
  useUser,
  useUsers,
} from './use-users'

const USER_ID = 42

function user(overrides: Partial<MockUser> = {}): MockUser {
  return {
    id: USER_ID,
    name: 'Dana Ortiz',
    email: 'dana@example.test',
    profile_image_url: '',
    groups: [2],
    api_key: 'k',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    is_disabled: false,
    is_invitation_pending: false,
    active_at: '',
    is_email_verified: true,
    auth_type: 'password',
    ...overrides,
  }
}

/** The list and the detail entry, mounted together with every write. */
function harness(filter?: 'active' | 'pending' | 'disabled') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
  const { result } = renderHook(
    () => ({
      list: useUsers(filter),
      detail: useUser(USER_ID),
      create: useCreateUser(),
      update: useUpdateUser(),
      disable: useDisableUser(),
      enable: useEnableUser(),
    }),
    { wrapper: Wrapper }
  )
  return { qc, result }
}

/** Both reads settled, so a later refetch count means something. */
async function settled(filter?: 'active' | 'pending' | 'disabled') {
  const h = harness(filter)
  await waitFor(() => {
    expect(h.result.current.list.isSuccess).toBe(true)
    expect(h.result.current.detail.isSuccess).toBe(true)
  })
  return h
}

function callCounts() {
  return {
    list: vi.mocked(usersService.list).mock.calls.length,
    detail: vi.mocked(usersService.get).mock.calls.length,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(usersService.list).mockResolvedValue({ count: 1, results: [user()] })
  vi.mocked(usersService.get).mockResolvedValue(user())
})

describe('reading users from a backend that refuses', () => {
  // The bug this rejects: a hook that reports only {data, isLoading} lets a
  // refused read render as "no users yet", so a broken backend looks like an
  // empty org and nobody goes looking for the failure.
  it('surfaces a rejected list as an error rather than as no rows', async () => {
    vi.mocked(usersService.list).mockRejectedValue(new Error('502 from Redash'))
    const { result } = harness()

    await waitFor(() => expect(result.current.list.isError).toBe(true))
    expect(result.current.list.data).toBeUndefined()
  })

  it('reports an org with no users as a success carrying zero rows', async () => {
    vi.mocked(usersService.list).mockResolvedValue({ count: 0, results: [] })
    const { result } = harness()

    await waitFor(() => expect(result.current.list.isSuccess).toBe(true))
    expect(result.current.list.isError).toBe(false)
    expect(result.current.list.data).toEqual({ count: 0, results: [] })
  })

  it('surfaces a rejected detail read as an error too', async () => {
    vi.mocked(usersService.get).mockRejectedValue(new Error('500'))
    const { result } = harness()

    await waitFor(() => expect(result.current.detail.isError).toBe(true))
    expect(result.current.detail.data).toBeUndefined()
  })
})

describe('reading users', () => {
  it('passes the tab filter to the backend instead of filtering client-side', async () => {
    await settled('disabled')

    expect(vi.mocked(usersService.list)).toHaveBeenCalledWith('disabled')
  })

  it('caches the pending tab apart from the disabled one', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    }
    const { result } = renderHook(
      () => ({ pending: useUsers('pending'), disabled: useUsers('disabled') }),
      { wrapper: Wrapper }
    )

    await waitFor(() => {
      expect(result.current.pending.isSuccess).toBe(true)
      expect(result.current.disabled.isSuccess).toBe(true)
    })
    // Two separate reads: one shared cache entry would show the disabled tab
    // whichever tab was opened first.
    expect(vi.mocked(usersService.list).mock.calls).toEqual([['pending'], ['disabled']])
  })

  it('does not read a user before there is an id to read', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useUser(undefined), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      ),
    })

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'))
    expect(vi.mocked(usersService.get)).not.toHaveBeenCalled()
  })
})

describe('writing a user, and what it repairs afterwards', () => {
  // A mail-less install answers the create with the invite link, since nothing
  // will be mailed to the new person. Asserted with toMatchObject rather than a
  // property read because the mutation's inferred type is the union of the real
  // and the mock branch, and the mock branch has no invite_link, so a caller
  // cannot reach the field without a cast. See the report.
  it('hands back the invite link a mail-less install answers with', async () => {
    vi.mocked(usersService.create).mockResolvedValue({
      ...user({ id: 43, is_invitation_pending: true }),
      invite_link: 'https://redash.test/invite/abc',
    })
    const { result } = await settled()

    const created = await act(async () =>
      result.current.create.mutateAsync({ name: 'New Person', email: 'new@example.test' })
    )

    expect(created).toMatchObject({ invite_link: 'https://redash.test/invite/abc' })
  })

  it('refreshes the list after a create, since a new user has no detail entry yet', async () => {
    vi.mocked(usersService.create).mockResolvedValue(user({ id: 43 }))
    const { result } = await settled()
    const before = callCounts()

    await act(async () => {
      await result.current.create.mutateAsync({ name: 'New Person', email: 'new@example.test' })
    })

    await waitFor(() => expect(callCounts().list).toBe(before.list + 1))
    expect(callCounts().detail).toBe(before.detail)
  })

  it('refreshes both the list and that user after an update', async () => {
    vi.mocked(usersService.update).mockResolvedValue(user({ name: 'Dana O.' }))
    const { result } = await settled()
    const before = callCounts()

    await act(async () => {
      await result.current.update.mutateAsync({ id: USER_ID, name: 'Dana O.' })
    })

    await waitFor(() => expect(callCounts().detail).toBe(before.detail + 1))
    expect(callCounts().list).toBe(before.list + 1)
    expect(vi.mocked(usersService.update)).toHaveBeenCalledWith(USER_ID, { name: 'Dana O.' })
  })

  // DEFECT, pinned as it stands rather than as it should be: disable and enable
  // invalidate ['users'] only, while useUpdateUser next door invalidates
  // ['user', id] as well. Anything reading that user's own cache entry keeps
  // showing them as active after they were disabled. Reported, not fixed here.
  // When use-users.ts:105 and :119 add the detail key, these two assertions
  // flip to `before.detail + 1` and this comment goes away.
  it('refreshes the list but NOT that user after a disable', async () => {
    vi.mocked(usersService.disable).mockResolvedValue(undefined)
    const { result } = await settled()
    const before = callCounts()

    await act(async () => {
      await result.current.disable.mutateAsync(USER_ID)
    })

    await waitFor(() => expect(callCounts().list).toBe(before.list + 1))
    expect(callCounts().detail).toBe(before.detail)
  })

  it('refreshes the list but NOT that user after an enable', async () => {
    vi.mocked(usersService.enable).mockResolvedValue(undefined)
    const { result } = await settled()
    const before = callCounts()

    await act(async () => {
      await result.current.enable.mutateAsync(USER_ID)
    })

    await waitFor(() => expect(callCounts().list).toBe(before.list + 1))
    expect(callCounts().detail).toBe(before.detail)
  })

  it('leaves the list alone when the write is refused', async () => {
    vi.mocked(usersService.disable).mockRejectedValue(new Error('403'))
    const { result } = await settled()
    const before = callCounts()

    await act(async () => {
      await result.current.disable.mutateAsync(USER_ID).catch(() => {})
    })

    await waitFor(() => expect(result.current.disable.isError).toBe(true))
    expect(callCounts().list).toBe(before.list)
  })
})
