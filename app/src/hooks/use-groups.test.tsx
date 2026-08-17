// `useGroups` in the mode a fresh clone runs in, plus the name lookup that
// exists so a stored group id never reaches a screen as a bare number.
//
// The store is a module-level singleton with no reset, so each test installs
// the exact set of groups it reasons about.
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MockGroup } from '@/lib/mock-data'
import { useMockDataStore } from '@/stores/mock-data-store'
import { groupNames, useGroups } from './use-groups'

function group(id: number, name: string): MockGroup {
  return {
    id,
    name,
    type: 'regular',
    created_at: '2026-07-01T00:00:00Z',
    permissions: [],
    members: [],
    data_sources: [],
  }
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  useMockDataStore.setState({ groups: [group(5, 'Transit ops'), group(9, 'Data stewards')] })
})

describe('useGroups', () => {
  it('returns every group in the org, not just the current user’s', async () => {
    const { result } = renderHook(() => useGroups(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual([
      { id: 5, name: 'Transit ops', type: 'regular' },
      { id: 9, name: 'Data stewards', type: 'regular' },
    ])
  })

  it('drops permissions and created_at, so neither can be read through this hook', async () => {
    const { result } = renderHook(() => useGroups(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(Object.keys(result.current.data?.[0] ?? {}).sort()).toEqual(['id', 'name', 'type'])
  })
})

describe('groupNames', () => {
  const groups = [
    { id: 5, name: 'Transit ops', type: 'regular' },
    { id: 9, name: 'Data stewards', type: 'regular' },
  ]

  it('renders ids as names, in the order given', () => {
    expect(groupNames([9, 5], groups)).toEqual(['Data stewards', 'Transit ops'])
  })

  it('keeps an id that matches no group, rather than dropping it', () => {
    // A writer group can be deleted while a dataset still names it. Dropping
    // the id would make the dataset look like it had one fewer writer than its
    // record says, which is the reading an admin would act on.
    expect(groupNames([5, 404], groups)).toEqual(['Transit ops', '#404'])
  })

  it('renders ids while the groups are still loading', () => {
    expect(groupNames([5, 9], undefined)).toEqual(['#5', '#9'])
  })
})
