import { isAppError } from '@/lib/errorIds'

export function isBackendUnconfigured(error: unknown): boolean {
  return (
    isAppError(error) &&
    error.context.status === 503 &&
    error.context.backendConfigured !== true
  )
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
