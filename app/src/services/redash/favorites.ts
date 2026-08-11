/**
 * Favorites against the real Redash backend.
 * POST adds, DELETE removes — the caller supplies the current state (read
 * from the React Query cache) so no extra GET is needed to pick the verb.
 */

import { redashApi } from '@/services/api-client'

export async function setFavorite(
  type: 'queries' | 'dashboards',
  id: number,
  favorite: boolean
): Promise<void> {
  if (favorite) {
    await redashApi.post(`${type}/${id}/favorite`)
  } else {
    await redashApi.delete(`${type}/${id}/favorite`)
  }
}
