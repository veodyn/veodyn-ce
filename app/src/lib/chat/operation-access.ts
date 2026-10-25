import { ApiError } from '@/services/api-client'
import type { RedashDashboard, RedashQuery } from '@/services/redash/types'
import type { RedashTransport } from './transport'

export interface Account {
  id: number
  permissions: string[]
  isAdmin: boolean
}

interface SessionBody {
  user?: { id?: unknown; permissions?: unknown }
}

export type StoredQuery = RedashQuery & { is_safe?: boolean }

export async function readAccount(transport: RedashTransport, signal: AbortSignal): Promise<Account | null> {
  try {
    const session = await transport.get<SessionBody>('session', undefined, signal)
    const id = session.user?.id
    if (typeof id !== 'number') return null
    const raw = session.user?.permissions
    const permissions = Array.isArray(raw) ? raw.filter((one): one is string => typeof one === 'string') : []
    return { id, permissions, isAdmin: permissions.includes('admin') }
  } catch (error) {
    if (signal.aborted) throw error
    return null
  }
}

export function mayPublish(account: Account, permission: 'publish_dashboard' | 'publish_visualization'): boolean {
  return account.isAdmin || account.permissions.includes(permission)
}

export function ownsOrAdmin(account: Account, ownerId: number | undefined): boolean {
  return account.isAdmin || (ownerId !== undefined && ownerId === account.id)
}

export async function readObject<T>(transport: RedashTransport, path: string, signal: AbortSignal): Promise<T | null> {
  try {
    return await transport.get<T>(path, undefined, signal)
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return null
    throw error
  }
}

export function queryOwner(raw: StoredQuery): number | undefined {
  return raw.user?.id
}

export function dashboardOwner(raw: RedashDashboard): number | undefined {
  return raw.user_id ?? raw.user?.id
}

export function isSafe(raw: StoredQuery): boolean {
  return raw.is_safe ?? true
}
