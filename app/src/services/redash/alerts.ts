/**
 * Alerts against the real Redash backend.
 * GET /api/alerts returns a bare array. Real alerts carry the full query
 * inline (no flat query_id, no destinations field — destinations come from
 * the subscriptions sub-resource). Mute is POST/DELETE /alerts/:id/mute,
 * not an options flag.
 */

import { redashApi, ApiError } from '@/services/api-client'
import type { MockAlert } from '@/lib/mock-data'

interface RedashAlert {
  id: number
  name: string
  options: MockAlert['options']
  state: MockAlert['state']
  last_triggered_at: string | null
  rearm: number | null
  user: { id: number; name: string; email: string }
  query?: { id: number; name: string; data_source_id: number }
  created_at: string
  updated_at: string
}

export interface RedashAlertSubscription {
  id: number
  alert_id: number
  user: { id: number; name: string; email: string }
  destination?: { id: number; name: string; type: string } | null
}

function normalizeAlert(raw: RedashAlert): MockAlert {
  return {
    id: raw.id,
    name: raw.name,
    query_id: raw.query?.id ?? 0,
    query: raw.query ?? { id: 0, name: '', data_source_id: 0 },
    user: raw.user,
    options: { ...raw.options, muted: raw.options?.muted ?? false },
    state: raw.state ?? 'unknown',
    last_triggered_at: raw.last_triggered_at ?? null,
    rearm: raw.rearm ?? null,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    // Stays empty on purpose. There is no destinations field on the wire (see
    // the header), and filling it would need one subscriptions request per
    // alert in list(). MockAlert still declares the field for the fixtures,
    // which seed mock mode from it; every real consumer reads the attached set
    // off useAlertSubscriptions instead.
    destinations: [],
  }
}

export async function list(): Promise<MockAlert[]> {
  const raw = await redashApi.get<RedashAlert[]>('alerts')
  return raw.map(normalizeAlert)
}

export async function get(id: number): Promise<MockAlert | null> {
  try {
    return normalizeAlert(await redashApi.get<RedashAlert>(`alerts/${id}`))
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

export async function create(data: Partial<MockAlert>): Promise<MockAlert> {
  return normalizeAlert(
    await redashApi.post<RedashAlert>('alerts', {
      name: data.name || 'New Alert',
      query_id: data.query_id,
      options: data.options ?? { column: '', op: 'greater than', value: 0 },
      rearm: data.rearm ?? null,
    })
  )
}

export async function update(id: number, changes: Partial<MockAlert>): Promise<MockAlert> {
  const payload: Record<string, unknown> = {}
  if (changes.name !== undefined) payload.name = changes.name
  if (changes.query_id !== undefined) payload.query_id = changes.query_id
  if (changes.options !== undefined) payload.options = changes.options
  if (changes.rearm !== undefined) payload.rearm = changes.rearm
  return normalizeAlert(await redashApi.post<RedashAlert>(`alerts/${id}`, payload))
}

export async function remove(id: number): Promise<void> {
  await redashApi.delete(`alerts/${id}`)
}

export async function mute(id: number, muted: boolean): Promise<void> {
  if (muted) {
    await redashApi.post(`alerts/${id}/mute`)
  } else {
    await redashApi.delete(`alerts/${id}/mute`)
  }
}

export function listSubscriptions(alertId: number) {
  return redashApi.get<RedashAlertSubscription[]>(`alerts/${alertId}/subscriptions`)
}

export function subscribe(alertId: number, destinationId?: number | null) {
  return redashApi.post<RedashAlertSubscription>(
    `alerts/${alertId}/subscriptions`,
    destinationId != null ? { destination_id: destinationId } : {}
  )
}

export async function unsubscribe(alertId: number, subscriptionId: number): Promise<void> {
  await redashApi.delete(`alerts/${alertId}/subscriptions/${subscriptionId}`)
}
