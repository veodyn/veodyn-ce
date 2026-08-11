'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { forwardBoundaryError } from '@/lib/observability/errorForwarding'

/**
 * The app had no error boundary at all before this, so an unhandled throw showed
 * Next's default screen with no way back into the app.
 *
 * The raw message is deliberately not rendered. In this product an error string
 * can carry a fragment of SQL or a column value, and this screen is the one
 * place a failure is shown to whoever is looking at the tenant's data.
 *
 * `digest` is the handle on the underlying error instead: Next strips the
 * message in production, and the digest is what ties this screen to the server
 * log line and to the captured exception.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    forwardBoundaryError(error, {
      route: typeof window === 'undefined' ? '' : window.location.pathname,
      digest: error.digest,
    })
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="text-muted-foreground max-w-md text-sm">
        This page could not be displayed. The problem has been reported.
      </p>
      {error.digest !== undefined && (
        <p className="text-muted-foreground font-mono text-xs">Reference: {error.digest}</p>
      )}
      <Button onClick={reset}>Try again</Button>
    </div>
  )
}
