'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Gates the authenticated routes on there being a session.
 *
 * In real-backend mode the root layout reads the session server-side
 * (src/lib/server-session.ts) and Providers seeds the store before this first
 * renders, so the fetch below is the fallback for the two cases the server
 * declines: mock mode, and a backend the server could not reach. An
 * unauthenticated visitor goes to /login and comes back to where they were.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  // One selector per field: useAuthStore() with no selector subscribes to the
  // whole store, and this wraps every authenticated route, so any unrelated
  // write re-renders the entire app underneath it.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isLoading = useAuthStore((s) => s.isLoading)
  const loadSession = useAuthStore((s) => s.loadSession)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (!isAuthenticated && isLoading) {
      loadSession()
    }
  }, [isAuthenticated, isLoading, loadSession])

  useEffect(() => {
    if (isLoading || isAuthenticated) return
    // window.location rather than useSearchParams: the hook would force a
    // Suspense boundary around every authenticated route and opt each page out
    // of static rendering.
    const query = typeof window === 'undefined' ? '' : window.location.search
    router.replace(`/login?next=${encodeURIComponent(pathname + query)}`)
  }, [isAuthenticated, isLoading, pathname, router])

  if (isLoading) {
    return <SessionInterstitial label="Loading session" />
  }

  // The redirect above is in flight. Rendering the children here would flash a
  // protected page at someone who has no session.
  if (!isAuthenticated) {
    return <SessionInterstitial label="Redirecting to sign in" />
  }

  return <>{children}</>
}

/**
 * The app shell with nothing in it yet, so arriving is a fill rather than a
 * redraw. The label is on the container and the blocks are aria-hidden, so a
 * screen reader hears the state once instead of walking a fence of empty divs.
 */
function SessionInterstitial({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen bg-background" role="status" aria-label={label}>
      {/* Widths vary because a column of identical bars reads as a loading GIF
          rather than as a nav list. */}
      <div
        aria-hidden="true"
        className="w-60 shrink-0 space-y-3 border-r bg-card p-4 motion-safe:animate-pulse"
      >
        <div className="mb-6 h-6 w-28 rounded bg-muted" />
        {[36, 28, 32, 24, 30, 26, 34, 22].map((w, i) => (
          <div key={i} className="h-4 rounded bg-muted/60" style={{ width: `${w * 4}px` }} />
        ))}
      </div>
      <div aria-hidden="true" className="min-w-0 flex-1 p-8 motion-safe:animate-pulse">
        <div className="mb-6 space-y-2">
          <div className="h-7 w-48 rounded bg-muted" />
          <div className="h-4 w-72 rounded bg-muted/60" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-4 w-full rounded bg-muted/60" />
          ))}
        </div>
      </div>
    </div>
  )
}
