import { isAppError } from '@/lib/errorIds'

/**
 * The KPI, Reports and Data Catalog contracts live on backends configured
 * independently of Redash (`KPI_API_URL`, `REPORTS_API_URL`, `CATALOG_API_URL`).
 * Their route handlers answer **503** when their URL is unset, which is the
 * agreed "not wired yet" signal.
 *
 * `USE_REAL_API` only knows about Redash. Without this helper, pointing the app
 * at a real Redash would switch those surfaces onto backends that do not exist,
 * and they would render nothing at all rather than falling back to fixtures.
 *
 * Only 503 falls back. A 4xx or a 500 from a configured backend is a real
 * failure and must surface, not be papered over with fixture data.
 */
export function isBackendUnconfigured(error: unknown): boolean {
  return isAppError(error) && error.context.status === 503
}

export async function withFixtureFallback<T>(
  real: () => Promise<T>,
  fixture: () => T
): Promise<T> {
  try {
    return await real()
  } catch (error) {
    if (isBackendUnconfigured(error)) return fixture()
    throw error
  }
}
