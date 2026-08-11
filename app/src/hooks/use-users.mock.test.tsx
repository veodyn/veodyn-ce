// The user hooks with no backend, which is the mode the demo and every e2e run
// use. The three tabs are computed here rather than server-side, so the split
// between them is this file's subject: a user who is both invited and disabled
// must not appear under Active, and an invited user must leave the Pending tab
// the moment they are made active.
//
// The store is a module-level singleton with no reset, so each test installs
// the exact set of users it reasons about.
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MockUser } from '@/lib/mock-data'
import { useMockDataStore } from '@/stores/mock-data-store'
import {
  useCreateUser,
  useDisableUser,
  useEnableUser,
  useUpdateUser,
  useUser,
  useUsers,
} from './use-users'

function user(id: number, name: string, overrides: Partial<MockUser> = {}): MockUser {
  return {
    id,
    name,
    email: `${name.toLowerCase()}@example.test`,
    profile_image_url: '',
    groups: [2],
    api_key: `k-${id}`,
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

const ACTIVE = user(1, 'Active')
const INVITED = user(2, 'Invited', { is_invitation_pending: true })
const DISABLED = user(3, 'Disabled', { is_disabled: true })

function harness(filter?: 'active' | 'pending' | 'disabled', detailId = ACTIVE.id) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
  const { result } = renderHook(
    () => ({
      list: useUsers(filter),
      detail: useUser(detailId),
      create: useCreateUser(),
      update: useUpdateUser(),
      disable: useDisableUser(),
      enable: useEnableUser(),
    }),
    { wrapper: Wrapper }
  )
  return { qc, result }
}

async function settled(filter?: 'active' | 'pending' | 'disabled', detailId = ACTIVE.id) {
  const h = harness(filter, detailId)
  await waitFor(() => {
    expect(h.result.current.list.isSuccess).toBe(true)
    expect(h.result.current.detail.isSuccess).toBe(true)
  })
  return h
}

function names(rows: { results: MockUser[] } | undefined) {
  return rows?.results.map((u) => u.name)
}

beforeEach(() => {
  useMockDataStore.setState({ users: [ACTIVE, INVITED, DISABLED] })
})

describe('which tab a user lands on', () => {
  it('keeps the invited and the disabled out of the default tab', async () => {
    const { result } = await settled()

    expect(names(result.current.list.data)).toEqual(['Active'])
    expect(result.current.list.data?.count).toBe(1)
  })

  it('treats an explicit active filter the same as no filter', async () => {
    const { result } = await settled('active')

    expect(names(result.current.list.data)).toEqual(['Active'])
  })

  it('shows only outstanding invitations under pending', async () => {
    const { result } = await settled('pending')

    expect(names(result.current.list.data)).toEqual(['Invited'])
  })

  it('shows only disabled accounts under disabled', async () => {
    const { result } = await settled('disabled')

    expect(names(result.current.list.data)).toEqual(['Disabled'])
  })

  // A disabled account whose invitation was never accepted is disabled first:
  // listing it under Pending invites someone to chase an invite that cannot be
  // completed, and Active would be plainly wrong.
  it('keeps a disabled invitee out of the active tab', async () => {
    useMockDataStore.setState({ users: [user(4, 'Both', { is_disabled: true, is_invitation_pending: true })] })
    const { result } = await settled()

    expect(names(result.current.list.data)).toEqual([])
    expect(result.current.list.isError).toBe(false)
  })

  it('answers null for a user id nothing matches, rather than throwing', async () => {
    const { result } = await settled(undefined, 999)

    expect(result.current.detail.data).toBeNull()
    expect(result.current.detail.isError).toBe(false)
  })
})

describe('writing a user with no backend', () => {
  it('creates the account as an outstanding invitation, not as an active user', async () => {
    const { result } = await settled('pending')

    await act(async () => {
      await result.current.create.mutateAsync({ name: 'Newcomer', email: 'new@example.test' })
    })

    // Through the cache, so the invalidation is under test as well as the write.
    await waitFor(() => expect(names(result.current.list.data)).toEqual(['Invited', 'Newcomer']))
    const created = useMockDataStore.getState().users.find((u) => u.name === 'Newcomer')
    expect(created?.is_invitation_pending).toBe(true)
    expect(created?.is_disabled).toBe(false)
  })

  it('gives the new user an id nothing else in the store holds', async () => {
    const { result } = await settled('pending')

    await act(async () => {
      await result.current.create.mutateAsync({ name: 'Newcomer', email: 'new@example.test' })
    })

    const ids = useMockDataStore.getState().users.map((u) => u.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // The staleness this rejects: the mutation reads its result back off the
  // store snapshot the component rendered with, which still points at the
  // pre-write array.
  it('resolves an update with the renamed user, not the one from before the write', async () => {
    const { result } = await settled()

    const updated = await act(async () =>
      result.current.update.mutateAsync({ id: ACTIVE.id, name: 'Renamed' })
    )

    expect(updated.name).toBe('Renamed')
    expect(updated.updated_at).not.toBe(ACTIVE.updated_at)
  })

  it('moves a disabled user out of the active tab and into the disabled one', async () => {
    const { result } = await settled()
    expect(names(result.current.list.data)).toEqual(['Active'])

    await act(async () => {
      await result.current.disable.mutateAsync(ACTIVE.id)
    })

    await waitFor(() => expect(names(result.current.list.data)).toEqual([]))
    expect(useMockDataStore.getState().users.find((u) => u.id === ACTIVE.id)?.is_disabled).toBe(true)
  })

  it('brings an enabled user back into the active tab', async () => {
    const { result } = await settled(undefined, DISABLED.id)

    await act(async () => {
      await result.current.enable.mutateAsync(DISABLED.id)
    })

    await waitFor(() => expect(names(result.current.list.data)).toEqual(['Active', 'Disabled']))
  })

  // Enabling must clear only the disabled flag: an invitation that is still
  // outstanding is not completed by an admin flipping the switch.
  it('leaves an outstanding invitation outstanding when the account is enabled', async () => {
    useMockDataStore.setState({
      users: [user(5, 'Invitee', { is_disabled: true, is_invitation_pending: true })],
    })
    const { result } = await settled('pending', 5)

    await act(async () => {
      await result.current.enable.mutateAsync(5)
    })

    await waitFor(() => expect(names(result.current.list.data)).toEqual(['Invitee']))
    expect(useMockDataStore.getState().users[0].is_invitation_pending).toBe(true)
  })
})
