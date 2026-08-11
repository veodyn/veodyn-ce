'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { useMockDataStore } from '@/stores/mock-data-store'
import { useAuthStore } from '@/stores/auth-store'
import { USE_REAL_API } from '@/services/redash/config'
import { redashApi } from '@/services/api-client'
import { required } from '@/lib/required'
import type { MockUser } from '@/lib/mock-data'
import type { RedashGroup, RedashUserDetail } from '@/components/users/user-detail-types'

// ---------------------------------------------------------------------------
// The signed-in user's own account, for /profile.
//
// Mock-aware on purpose. Reading straight through redashApi works only when
// REDASH_URL is set; without it the proxy answers 503 by design
// (app/api/node/[...path]/route.ts), and mock mode is the mode a fresh clone
// and the e2e suite both run in. A profile that 503s there would mean the
// permanent sidebar link lands on an error screen out of the box.
// ---------------------------------------------------------------------------

/** MockUser carries every field of RedashUserDetail except disabled_at. */
function fromMock(user: MockUser): RedashUserDetail {
  return {
    ...user,
    profile_image_url: user.profile_image_url || null,
    disabled_at: user.is_disabled ? user.updated_at : null,
  }
}

export function useProfile() {
  const currentUser = useAuthStore((s) => s.currentUser)
  const store = useMockDataStore()
  const userId = currentUser?.id

  return useQuery({
    queryKey: ['profile', userId],
    queryFn: async (): Promise<RedashUserDetail | null> => {
      if (USE_REAL_API) {
        return redashApi.get<RedashUserDetail>(`users/${userId}`)
      }
      const found = store.users.find((u) => u.id === userId)
      return found ? fromMock(found) : null
    },
    enabled: userId !== undefined,
  })
}

/**
 * The caller's own groups.
 *
 * Its own query rather than part of the profile fetch: a failure here costs
 * the group list, not the API key the page exists to show. Redash does not
 * gate GET /api/groups on admin, it returns only the caller's own groups to a
 * non-admin, so this is the read-only list the profile wants.
 */
export function useProfileGroups() {
  const currentUser = useAuthStore((s) => s.currentUser)
  const store = useMockDataStore()
  const userId = currentUser?.id

  return useQuery({
    queryKey: ['profile', 'groups', userId],
    queryFn: async (): Promise<RedashGroup[]> => {
      if (USE_REAL_API) {
        return redashApi.get<RedashGroup[]>('groups')
      }
      const mine = store.users.find((u) => u.id === userId)?.groups ?? []
      return store.groups
        .filter((group) => mine.includes(group.id))
        .map(({ id, name, type }) => ({ id, name, type }))
    },
    enabled: userId !== undefined,
  })
}

// ---------------------------------------------------------------------------
// Mutations. Mock-aware for the same reason the reads are: without REDASH_URL
// every one of these would 503, so in the mode a fresh clone runs in the
// profile would render but none of its buttons would work. Shared with the
// admin user view, which was equally broken there.
// ---------------------------------------------------------------------------

/** The refreshed record, read back from whichever store actually holds it. */
function mockUserAfter(id: number, updates: Partial<MockUser>): RedashUserDetail {
  useMockDataStore.getState().updateUser(id, { ...updates, updated_at: new Date().toISOString() })
  const updated = useMockDataStore.getState().users.find((u) => u.id === id)
  return fromMock(required(updated, 'the updated user'))
}

export function useSaveAccount(userId: number) {
  return useMutation({
    mutationFn: async (fields: { name: string; email: string }): Promise<RedashUserDetail> => {
      if (USE_REAL_API) {
        return redashApi.post<RedashUserDetail>(`users/${userId}`, fields)
      }
      return mockUserAfter(userId, fields)
    },
  })
}

export function useRegenerateApiKey(userId: number) {
  return useMutation({
    mutationFn: async (): Promise<RedashUserDetail> => {
      if (USE_REAL_API) {
        return redashApi.post<RedashUserDetail>(`users/${userId}/regenerate_api_key`)
      }
      // Visibly different from the old one, so the demo shows what regenerating
      // actually does rather than appearing to be a no-op.
      const suffix = Math.random().toString(36).slice(2, 10)
      return mockUserAfter(userId, { api_key: `mock-api-key-${userId}-${suffix}` })
    },
  })
}

export function useChangePassword(userId: number) {
  return useMutation({
    mutationFn: async (fields: { oldPassword: string; newPassword: string }): Promise<void> => {
      if (USE_REAL_API) {
        await redashApi.post(`users/${userId}`, {
          old_password: fields.oldPassword,
          password: fields.newPassword,
        })
        return
      }
      // The mock pack stores no passwords, so there is nothing to check the
      // old one against and nothing to write. Succeeding is the honest answer:
      // failing would report a problem that does not exist.
    },
  })
}
