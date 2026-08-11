/**
 * Alert destinations against the real Redash backend.
 *
 * `created_at` is not part of the wire shape, and the list endpoint omits
 * `options` entirely: `NotificationDestination.to_dict()` only serialises them
 * under `all=True`, which just the single-destination read passes. Anything
 * that needs a destination's configuration (an edit form, a config summary)
 * has to call `get()`, never pick the item out of `list()`, whose `options` is
 * an empty object standing in for a field the backend never sent.
 */

import { redashApi, ApiError } from '@/services/api-client'
import type { MockDestination } from '@/lib/mock-data'

interface RedashDestination {
  id: number
  name: string
  type: string
  icon?: string
  options?: Record<string, unknown>
}

export interface RedashDestinationType {
  type: string
  name: string
  icon?: string
  configuration_schema: Record<string, unknown>
}

/**
 * The body `POST /destinations/<id>` requires.
 *
 * All three fields are mandatory because the handler reads `req["type"]`,
 * `req["name"]` and `req["options"]` with no `require_fields` guard, so a
 * missing key is a KeyError, not a partial update. Optional fields here would
 * let a caller send `{name}` alone and get a 500 from the backend.
 */
export interface DestinationUpdate {
  name: string
  type: string
  options: Record<string, unknown>
}

function normalizeDestination(raw: RedashDestination): MockDestination {
  return {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    options: raw.options ?? {},
    created_at: '',
  }
}

export async function list(): Promise<MockDestination[]> {
  const raw = await redashApi.get<RedashDestination[]>('destinations')
  return raw.map(normalizeDestination)
}

export async function get(id: number): Promise<MockDestination | null> {
  try {
    return normalizeDestination(
      await redashApi.get<RedashDestination>(`destinations/${id}`)
    )
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

export function listTypes() {
  return redashApi.get<RedashDestinationType[]>('destinations/types')
}

export async function create(data: DestinationUpdate): Promise<MockDestination> {
  return normalizeDestination(await redashApi.post<RedashDestination>('destinations', data))
}

export async function update(id: number, data: DestinationUpdate): Promise<MockDestination> {
  return normalizeDestination(
    await redashApi.post<RedashDestination>(`destinations/${id}`, data)
  )
}

export async function remove(id: number): Promise<void> {
  await redashApi.delete(`destinations/${id}`)
}
