import { ApiError } from '@/services/api-client'
import type { RedashDashboard, RedashWidget } from '@/services/redash/types'
import type { RedashTransport } from './transport'

export type WidgetOptions = Record<string, unknown> & {
  position?: Record<string, unknown>
  parameterMappings?: Record<string, unknown>
}

export interface WidgetCreate {
  dashboard_id: number
  visualization_id: number | null
  text?: string
  width?: number
  options: WidgetOptions
  idempotency_key?: string
}

export interface WidgetWrite {
  text: string
  width: number
  options: WidgetOptions
}

export interface DashboardChanges {
  name?: string
  tags?: string[]
}

export async function getRawDashboard(
  transport: RedashTransport,
  id: number,
  signal?: AbortSignal
): Promise<RedashDashboard | null> {
  try {
    return await transport.get<RedashDashboard>(`dashboards/${id}`, undefined, signal)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

export function createWidget(
  transport: RedashTransport,
  data: WidgetCreate,
  signal?: AbortSignal
): Promise<RedashWidget> {
  return transport.post<RedashWidget>(
    'widgets',
    {
      dashboard_id: data.dashboard_id,
      visualization_id: data.visualization_id,
      text: data.text ?? '',
      width: data.width ?? 1,
      options: { isHidden: false, ...data.options, position: { autoHeight: false, ...data.options.position } },
      ...(data.idempotency_key ? { idempotency_key: data.idempotency_key } : {}),
    },
    signal
  )
}

export function updateWidget(
  transport: RedashTransport,
  id: number,
  data: WidgetWrite,
  expectedUpdatedAt?: string,
  signal?: AbortSignal
): Promise<RedashWidget> {
  const body = expectedUpdatedAt === undefined ? data : { ...data, expected_updated_at: expectedUpdatedAt }
  return transport.post<RedashWidget>(`widgets/${id}`, body, signal)
}

export async function deleteWidget(
  transport: RedashTransport,
  id: number,
  expectedUpdatedAt?: string,
  signal?: AbortSignal
): Promise<void> {
  const params = expectedUpdatedAt === undefined ? undefined : { expected_updated_at: expectedUpdatedAt }
  await transport.del<void>(`widgets/${id}`, params, signal)
}

export function updateDashboard(
  transport: RedashTransport,
  id: number,
  changes: DashboardChanges,
  expectedUpdatedAt?: string,
  signal?: AbortSignal
): Promise<RedashDashboard> {
  const body = expectedUpdatedAt === undefined ? changes : { ...changes, expected_updated_at: expectedUpdatedAt }
  return transport.post<RedashDashboard>(`dashboards/${id}`, body, signal)
}
