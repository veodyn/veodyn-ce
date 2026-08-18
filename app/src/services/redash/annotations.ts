/**
 * Dashboard annotations. The backend resource does not exist: these calls are
 * modeled against a plausible /annotations path and fail (404/503) in real mode.
 */

import { redashApi } from '@/services/api-client'
import { USE_REAL_API } from '@/services/redash/config'
import type { Annotation } from '@/types/annotation'

/**
 * Whether this instance can actually store an annotation. Mock mode only: in
 * real mode every write answers 405, so callers gate their entry point on this.
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
