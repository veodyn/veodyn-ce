import { vi } from 'vitest'
import type { DashboardEditPayload, DashboardOperation } from './dashboard-changes'
import type { DashboardEditDraft } from './dashboard-edit-apply'
import type { RedashTransport } from './transport'
import type { ChatPromotion } from './wire'

export const SNAPSHOT_STAMP = '2026-10-24T10:00:00.000Z'
export const SAVED_STAMP = '2026-10-24T10:05:00.000Z'

export const pending: ChatPromotion = {
  id: 'p1',
  targetType: 'dashboard',
  targetId: '4',
  promotedVersion: 1,
  targetVersionAtPromote: null,
  status: 'pending',
  receipts: [],
  createdAt: '2026-10-24T10:01:00Z',
  updatedAt: '2026-10-24T10:01:00Z',
}

export const POSITION = { col: 0, row: 0, sizeX: 3, sizeY: 8 }

export function rawWidget(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    dashboard_id: 4,
    text: id === 2 ? 'old text' : '',
    width: 1,
    options: { position: { ...POSITION, autoHeight: false }, isHidden: false, extraKey: `keep-${id}` },
    updated_at: `fresh-${id}`,
    visualization: id === 2 ? undefined : { id: id * 10, type: 'CHART', name: 'x', options: {}, query: { id: 1, name: 'q' } },
    ...overrides,
  }
}

export function rawDashboard(widgets: unknown[] = [rawWidget(1), rawWidget(2), rawWidget(3)]) {
  return {
    id: 4,
    name: 'Ops',
    tags: [],
    can_edit: true,
    is_archived: false,
    updated_at: SNAPSHOT_STAMP,
    widgets,
  }
}

export function draftFor(
  operations: DashboardOperation[],
  extra: Partial<DashboardEditPayload> = {},
  promotions: ChatPromotion[] = []
): DashboardEditDraft {
  const payload: DashboardEditPayload = {
    dashboardId: 4,
    snapshot: { name: 'Ops', tags: [], version: 3, updatedAt: SNAPSHOT_STAMP, widgets: [] },
    operations,
    ...extra,
  }
  return { id: 'd1', versions: [{ version: 1, payload }], promotions }
}

export function target(op: 'editText' | 'move' | 'remove', widgetId: number, extra: Record<string, unknown> = {}) {
  return {
    op,
    widgetId,
    title: `Widget ${widgetId}`,
    updatedAt: `snap-${widgetId}`,
    position: { ...POSITION },
    ...extra,
  } as DashboardOperation
}

export function transportFor(options: { board?: unknown; failOn?: (path: string, verb: string) => Error | undefined } = {}) {
  const calls: string[] = []
  const get = vi.fn(async (path: string) => {
    calls.push(`GET ${path}`)
    return options.board ?? rawDashboard()
  })
  const post = vi.fn(async (...args: [string, unknown?, unknown?]) => {
    const [path] = args
    calls.push(`POST ${path}`)
    const error = options.failOn?.(path, 'POST')
    if (error) throw error
    return { id: path === 'widgets' ? 900 : 4, updated_at: SAVED_STAMP }
  })
  const del = vi.fn(async (path: string) => {
    calls.push(`DELETE ${path}`)
    const error = options.failOn?.(path, 'DELETE')
    if (error) throw error
    return undefined
  })
  return Object.assign({ get, post, del } as unknown as RedashTransport, { calls, get, post, del })
}
