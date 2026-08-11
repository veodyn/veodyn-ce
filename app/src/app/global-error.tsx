'use client'

import { useEffect } from 'react'
import { forwardBoundaryError } from '@/lib/observability/errorForwarding'

/**
 * Catches a throw in the root layout itself, which error.tsx cannot: at that
 * point no layout rendered, so this component supplies its own html and body.
 *
 * It deliberately uses plain elements and inline styles rather than the ui
 * primitives or Tailwind classes, because the failure it is handling may be the
 * stylesheet or the provider tree never mounting. A component imported from
 * src/components/ui here could be the very thing that just threw.
 */
export default function GlobalError({
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
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '4rem', textAlign: 'center' }}>
        <h2>Something went wrong</h2>
        <p>The application could not start. The problem has been reported.</p>
        {error.digest !== undefined && (
          <p style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
            Reference: {error.digest}
          </p>
        )}
        {/* eslint-disable-next-line no-restricted-syntax -- the ui/button
            primitive may be exactly what failed to load here, so this boundary
            cannot depend on it. */}
        <button type="button" onClick={reset} style={{ marginTop: '1rem', padding: '0.5rem 1rem' }}>
          Try again
        </button>
      </body>
    </html>
  )
}
