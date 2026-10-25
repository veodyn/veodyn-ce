import { vi } from 'vitest'
import { ApiError } from '@/services/api-client'
import type { ChatToolRequestOf } from './frames'
import type { RedashTransport } from './transport'

export const OWNER = 4
export const STRANGER = 9
export const STAMP = '2026-10-24T10:00:00.123Z'

export function sessionOf(id: number, permissions: string[]) {
  return { user: { id, permissions } }
}

export const OWNER_SESSION = sessionOf(OWNER, ['edit_query', 'publish_dashboard', 'publish_visualization'])
export const STRANGER_SESSION = sessionOf(STRANGER, ['edit_query', 'publish_dashboard', 'publish_visualization'])
export const ADMIN_SESSION = sessionOf(STRANGER, ['admin'])

export function rawQuery(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    name: 'Weekly revenue',
    query: 'select 1',
    data_source_id: 2,
    is_archived: false,
    is_favorite: false,
    is_safe: true,
    updated_at: STAMP,
    latest_query_data_id: 90,
    can_edit: true,
    user: { id: OWNER },
    visualizations: [
      { id: 30, type: 'TABLE', name: 'Table', options: {}, updated_at: STAMP },
      { id: 31, type: 'CHART', name: 'Revenue by week', options: {}, updated_at: STAMP },
    ],
    ...overrides,
  }
}

export function rawDashboard(overrides: Record<string, unknown> = {}) {
  return {
    id: 3,
    name: 'Ops',
    slug: 'ops',
    is_archived: false,
    is_favorite: false,
    updated_at: STAMP,
    can_edit: true,
    user_id: OWNER,
    widgets: [],
    ...overrides,
  }
}

export const SOURCES = [{ id: 2, name: 'Warehouse', type: 'pg', syntax: 'sql', view_only: false }]

export function readsOf(handlers: Record<string, unknown>) {
  const get = vi.fn(async (path: string) => {
    if (!(path in handlers)) throw new ApiError(404, `unexpected ${path}`)
    const value = handlers[path]
    if (value instanceof Error) throw value
    return value
  })
  return { get, post: vi.fn(), del: vi.fn() } as unknown as RedashTransport & { get: ReturnType<typeof vi.fn> }
}

export function fork(): ChatToolRequestOf<'fork_query'> {
  return { callId: 'c1', tool: 'fork_query', args: { queryId: 7 } }
}

export function archiveQuery(restore = false): ChatToolRequestOf<'archive_query'> {
  return { callId: 'c1', tool: 'archive_query', args: { queryId: 7, restore } }
}

export function archiveDashboard(restore = false): ChatToolRequestOf<'archive_dashboard'> {
  return { callId: 'c1', tool: 'archive_dashboard', args: { dashboardId: 3, restore } }
}

export function favorite(kind: 'query' | 'dashboard', id: number, on = true): ChatToolRequestOf<'set_favorite'> {
  return { callId: 'c1', tool: 'set_favorite', args: { kind, id, favorite: on } }
}

export function shareDashboard(
  action: 'create' | 'revoke',
  expiresAt: string | null = null
): ChatToolRequestOf<'share_dashboard'> {
  return { callId: 'c1', tool: 'share_dashboard', args: { dashboardId: 3, action, expiresAt } }
}

export function shareChart(
  action: 'create' | 'revoke',
  refreshSeconds: number | null = null,
  expiresAt: string | null = null
): ChatToolRequestOf<'share_visualization'> {
  return {
    callId: 'c1',
    tool: 'share_visualization',
    args: { queryId: 7, visualizationId: 31, action, expiresAt, refreshSeconds },
  }
}
