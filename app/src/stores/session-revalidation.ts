import { isAppError } from '@/lib/errorIds'
import { useAuthStore } from '@/stores/auth-store'

let inFlight: Promise<void> | null = null

function isUnauthenticated(error: unknown): boolean {
  return isAppError(error) && error.context.status === 401
}

async function confirmSessionStillHeld(): Promise<void> {
  let response: Response
  try {
    response = await fetch('/api/auth/session', { credentials: 'include' })
  } catch {
    return
  }
  if (response.status !== 401) return
  useAuthStore.setState({ currentUser: null, isAuthenticated: false, isLoading: false })
}

export function revalidateSessionAfter(error: unknown): Promise<void> {
  if (!isUnauthenticated(error)) return Promise.resolve()
  if (!useAuthStore.getState().isAuthenticated) return Promise.resolve()
  if (!inFlight) {
    inFlight = confirmSessionStillHeld().finally(() => {
      inFlight = null
    })
  }
  return inFlight
}
