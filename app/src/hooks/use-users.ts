'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMockDataStore } from '@/stores/mock-data-store'
import { USE_REAL_API } from '@/services/redash/config'
import * as usersService from '@/services/redash/users'
import type { MockUser } from '@/lib/mock-data'
import { required } from '@/lib/required'

export function useUsers(filter?: 'active' | 'pending' | 'disabled') {
  const store = useMockDataStore()
  return useQuery({
    queryKey: ['users', filter],
    queryFn: () => {
      if (USE_REAL_API) {
        return usersService.list(filter)
      }
      let results = store.users
      if (filter === 'pending') results = results.filter((u) => u.is_invitation_pending)
      else if (filter === 'disabled') results = results.filter((u) => u.is_disabled)
      else results = results.filter((u) => !u.is_disabled && !u.is_invitation_pending)
      return { count: results.length, results }
    },
  })
}

export function useUser(id: number | undefined) {
  const store = useMockDataStore()
  return useQuery({
    queryKey: ['user', id],
    queryFn: () => {
      if (USE_REAL_API) {
        return usersService.get(required(id, 'the user id'))
      }
      return store.users.find((u) => u.id === id) ?? null
    },
    enabled: id !== undefined,
  })
}

export function useCreateUser() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (data: { name: string; email: string }) => {
      if (USE_REAL_API) {
        // On mail-less installs the response carries invite_link
        return usersService.create(data)
      }
      const id = store.nextId('users')
      const now = new Date().toISOString()
      const user: MockUser = {
        id,
        name: data.name,
        email: data.email,
        profile_image_url: '',
        groups: [2],
        api_key: `mock-api-key-${id}`,
        created_at: now,
        updated_at: now,
        is_disabled: false,
        is_invitation_pending: true,
        active_at: '',
        is_email_verified: false,
        auth_type: 'password',
      }
      store.addUser(user)
      return user
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<MockUser> & { id: number }) => {
      if (USE_REAL_API) {
        return usersService.update(id, updates)
      }
      store.updateUser(id, { ...updates, updated_at: new Date().toISOString() })
      return required(
        useMockDataStore.getState().users.find((u) => u.id === id),
        'the updated user'
      )
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['user', vars.id] })
    },
  })
}

export function useDisableUser() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (id: number) => {
      if (USE_REAL_API) {
        return usersService.disable(id)
      }
      store.updateUser(id, { is_disabled: true })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })
}

export function useEnableUser() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (id: number) => {
      if (USE_REAL_API) {
        return usersService.enable(id)
      }
      store.updateUser(id, { is_disabled: false })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })
}
