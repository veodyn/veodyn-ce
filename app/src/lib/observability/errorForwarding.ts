import { captureException, currentRoute } from './capture'

/** Called from the Next error boundaries, which receive `digest` and nothing else. */
export function forwardBoundaryError(
  error: unknown,
  ctx: { route?: string; digest?: string },
): void {
  captureException(error, { route: ctx.route ?? '', digest: ctx.digest ?? '' })
}

/** Catches what never reaches a boundary: rejected promises and window errors. */
export function installGlobalHandlers(): () => void {
  if (typeof window === 'undefined') return () => {}
  const onRejection = (e: PromiseRejectionEvent): void => {
    captureException(e.reason, { route: currentRoute(), kind: 'unhandledrejection' })
  }
  const onError = (e: ErrorEvent): void => {
    captureException(e.error ?? e.message, { route: currentRoute(), kind: 'window.error' })
  }
  window.addEventListener('unhandledrejection', onRejection)
  window.addEventListener('error', onError)
  return () => {
    window.removeEventListener('unhandledrejection', onRejection)
    window.removeEventListener('error', onError)
  }
}
