/**
 * Dashboard annotations against the real Redash backend.
 *
 * The backend contract here is defined, not implemented: upstream Redash has
 * no annotations resource. These calls are modeled against a plausible
 * /annotations path (dashboard-scoped list, create, delete) so the real-mode
 * branch has somewhere to go once a backend lands. Until then they will fail
 * against the proxy (404/503), matching the plan-06 catalog integration
 * stance of shipping the contract ahead of the implementation.
 */

import { redashApi } from '@/services/api-client'
import { USE_REAL_API } from '@/services/redash/config'
import type { Annotation } from '@/types/annotation'

/**
 * Whether this instance can actually store an annotation.
 *
 * Derived from the mode rather than declared as config, because it is not a
 * preference: in mock mode the store answers every call, and against a real
 * Redash there is no resource to answer any of them. A separate flag could
 * disagree with that, and the UI would be back to advertising a write that
 * cannot land.
 *
 * The reason it has to be readable from the UI at all: the dashboard shipped a
 * complete annotation surface against this absent backend, including an AI
 * suggester that spends ten seconds returning real drafts with an Accept on
 * each. Every write answered 405 and nothing said so, so "saved" and "silently
 * discarded" looked identical. Callers gate their entry point on this; when a
 * backend lands, implementing it is what flips this to true.
 */
export const ANNOTATIONS_SUPPORTED = !USE_REAL_API

export async function list(
  dashboardId: number,
  opts?: { signal?: AbortSignal }
): Promise<Annotation[]> {
  return redashApi.get<Annotation[]>('annotations', {
    params: { dashboard_id: dashboardId },
    signal: opts?.signal,
  })
}

export async function create(
  input: Omit<Annotation, 'id' | 'created_at'>,
  opts?: { signal?: AbortSignal }
): Promise<Annotation> {
  return redashApi.post<Annotation>('annotations', input, { signal: opts?.signal })
}

export async function remove(id: number, opts?: { signal?: AbortSignal }): Promise<void> {
  await redashApi.delete(`annotations/${id}`, { signal: opts?.signal })
}
