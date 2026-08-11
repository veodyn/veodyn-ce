/**
 * Users against the real Redash backend.
 * List supports disabled=true / pending=true filters. On mail-less installs
 * user creation returns an invite_link — surfaced to the caller.
 */

import { redashApi, ApiError } from '@/services/api-client'
import type { MockUser } from '@/lib/mock-data'
import type { RedashPaginatedResponse } from './types'

interface RedashUser {
  id: number
  name: string
  email: string
  profile_image_url?: string
  groups: Array<number | { id: number }>
  api_key?: string
  created_at?: string
  updated_at?: string
  is_disabled?: boolean
  is_invitation_pending?: boolean
  active_at?: string | null
  is_email_verified?: boolean
  auth_type?: string
  invite_link?: string
}

export function normalizeUser(raw: RedashUser): MockUser & { invite_link?: string } {
  return {
    id: raw.id,
    name: raw.name,
    email: raw.email,
    profile_image_url: raw.profile_image_url ?? '',
    // Some Redash versions serialize groups as objects
    groups: (raw.groups ?? []).map((g) => (typeof g === 'number' ? g : g.id)),
    api_key: raw.api_key ?? '',
    created_at: raw.created_at ?? '',
    updated_at: raw.updated_at ?? '',
    is_disabled: raw.is_disabled ?? false,
    is_invitation_pending: raw.is_invitation_pending ?? false,
    active_at: raw.active_at ?? '',
    is_email_verified: raw.is_email_verified ?? true,
    auth_type: raw.auth_type ?? 'password',
    invite_link: raw.invite_link,
  }
}

export async function list(
  filter?: 'active' | 'pending' | 'disabled'
): Promise<{ count: number; results: MockUser[] }> {
  const params: Record<string, string | number | boolean | undefined> = {
    page: 1,
    page_size: 250,
  }
  if (filter === 'disabled') params.disabled = true
  if (filter === 'pending') params.pending = true
  const raw = await redashApi.get<RedashPaginatedResponse<RedashUser>>('users', { params })
  return { count: raw.count, results: raw.results.map(normalizeUser) }
}

export async function get(id: number): Promise<MockUser | null> {
  try {
    return normalizeUser(await redashApi.get<RedashUser>(`users/${id}`))
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

export async function create(data: { name: string; email: string }) {
  return normalizeUser(await redashApi.post<RedashUser>('users', data))
}

export async function update(id: number, changes: Partial<MockUser>) {
  const payload: Record<string, unknown> = {}
  if (changes.name !== undefined) payload.name = changes.name
  if (changes.email !== undefined) payload.email = changes.email
  if (changes.groups !== undefined) payload.group_ids = changes.groups
  return normalizeUser(await redashApi.post<RedashUser>(`users/${id}`, payload))
}

export async function disable(id: number): Promise<void> {
  await redashApi.post(`users/${id}/disable`)
}

export async function enable(id: number): Promise<void> {
  await redashApi.delete(`users/${id}/disable`)
}
