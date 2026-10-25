import { vi } from 'vitest'
import { ApiError } from '@/services/api-client'
import type { RedashDashboard, RedashQuery } from '@/services/redash/types'
import { resolveDashboardEdit } from './dashboard-edit'
import type { ChatToolRequestOf } from './frames'
import type { RedashTransport } from './transport'

export const signal = new AbortController().signal
export const STAMP = '2026-10-24T10:00:00.123Z'

export type Args = ChatToolRequestOf<'update_dashboard'>['args']

export function chart(id: number, position: Record<string, number>, overrides: Record<string, unknown> = {}) {
  return {
    id,
    dashboard_id: 4,
    visualization: {
      id: id * 10,
      type: 'CHART',
      name: `Chart ${id}`,
      description: '',
      options: {},
      query: { id: id * 100, name: `Query ${id}` },
    },
    text: '',
    width: 1,
    options: { position },
    created_at: '',
    updated_at: `U${id}`,
    ...overrides,
  }
}

export function text(id: number, body: string, position: Record<string, number>, overrides: Record<string, unknown> = {}) {
  return {
    id,
    dashboard_id: 4,
    text: body,
    width: 1,
    options: { position },
    created_at: '',
    updated_at: `U${id}`,
    ...overrides,
  }
}

export function dashboard(overrides: Record<string, unknown> = {}): RedashDashboard {
  return {
    id: 4,
    name: 'Ops',
    tags: ['ops'],
    can_edit: true,
    is_archived: false,
    version: 3,
    updated_at: STAMP,
    widgets: [
      chart(1, { col: 0, row: 0, sizeX: 3, sizeY: 8 }),
      text(2, '## Notes\nmore', { col: 3, row: 0, sizeX: 3, sizeY: 4 }),
    ],
    ...overrides,
  } as unknown as RedashDashboard
}

export function query(id: number, overrides: Record<string, unknown> = {}): RedashQuery {
  return {
    id,
    name: `Trips ${id}`,
    is_archived: false,
    options: { parameters: [{ name: 'start', title: 'Start date', type: 'date', value: '2026-01-01' }] },
    visualizations: [
      { id: id * 10, type: 'CHART', name: 'Line', options: {} },
      { id: id * 10 + 1, type: 'COUNTER', name: 'Table', options: {} },
    ],
    ...overrides,
  } as unknown as RedashQuery
}

export function transportFor(board: RedashDashboard | Error, queries: Record<number, RedashQuery | Error> = {}) {
  const get = vi.fn(async (path: string) => {
    if (path === 'dashboards/4') {
      if (board instanceof Error) throw board
      return board
    }
    const id = Number(path.split('/')[1])
    const found = queries[id]
    if (!found) throw new ApiError(404, 'missing')
    if (found instanceof Error) throw found
    return found
  })
  return { get, post: vi.fn(), del: vi.fn() } as unknown as RedashTransport & { get: typeof get }
}

export function request(args: Omit<Args, 'dashboardId'>): ChatToolRequestOf<'update_dashboard'> {
  return { callId: '1-1', tool: 'update_dashboard', args: { dashboardId: 4, ...args } }
}

export async function resolve(args: Omit<Args, 'dashboardId'>, transport = transportFor(dashboard(), { 7: query(7) })) {
  const result = await resolveDashboardEdit(request(args), transport, signal)
  if (result.kind !== 'dashboard_edit') throw new Error('wrong kind')
  return result
}

export function overlaps(a: Record<string, number>, b: Record<string, number>): boolean {
  return a.col < b.col + b.sizeX && b.col < a.col + a.sizeX && a.row < b.row + b.sizeY && b.row < a.row + a.sizeY
}

