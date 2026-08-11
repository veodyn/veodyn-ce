/**
 * Dashboard widgets against the real Redash backend.
 *
 * Widget updates fully REPLACE `options` server-side — callers must send the
 * merged options object (position + parameterMappings + isHidden) or the
 * omitted keys are lost. visualization_id must always be present on create
 * (null for text widgets).
 */

import { redashApi } from '@/services/api-client'
import type { MockDashboardWidget } from '@/lib/mock-data'
import { normalizeWidget } from './dashboards'
import type { RedashWidget } from './types'

export async function createWidget(data: {
  dashboard_id: number
  visualization_id: number | null
  text?: string
  width?: number
  options: MockDashboardWidget['options']
}): Promise<MockDashboardWidget> {
  const raw = await redashApi.post<RedashWidget>('widgets', {
    dashboard_id: data.dashboard_id,
    visualization_id: data.visualization_id,
    text: data.text ?? '',
    width: data.width ?? 1,
    options: {
      isHidden: false,
      ...data.options,
      position: { autoHeight: false, ...data.options.position },
    },
  })
  return normalizeWidget(raw, data.dashboard_id)
}

export async function updateWidget(
  id: number,
  data: { text?: string; width?: number; options: MockDashboardWidget['options'] }
): Promise<void> {
  await redashApi.post(`widgets/${id}`, {
    text: data.text ?? '',
    width: data.width ?? 1,
    options: data.options,
  })
}

export async function deleteWidget(id: number): Promise<void> {
  await redashApi.delete(`widgets/${id}`)
}
