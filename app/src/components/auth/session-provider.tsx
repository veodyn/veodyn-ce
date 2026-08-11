'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Gates the authenticated routes on there being a session.
 *
 * In real-backend mode the session now arrives with the HTML: the root layout
 * reads it server-side (src/lib/server-session.ts) and Providers seeds the
 * store before this component first renders, so `isLoading` is already false
 * and the effect below has nothing to do. The fetch is the fallback for the two
 * cases the server declines to answer: mock mode, which auto-signs-in against
 * fixtures, and a backend the server could not reach, which is not a verdict
 * about the reader and so is asked again from here.
 *
 * An unauthenticated visitor goes to /login and comes back to where they were.
 * Rendering the sign-in card in place instead left the address bar on a page
 * the user could not see, and it meant a bookmarked deep link lost its
 * destination the moment the session check failed.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  // One selector per field. Calling useAuthStore() with no selector subscribes
  // to the WHOLE store, and this component wraps every authenticated route, so
  // any unrelated write (a login error being cleared, an org name arriving)
  // re-rendered the entire app underneath it.
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
    // window.location rather than useSearchParams: this provider wraps every
    // authenticated route, and the hook would force a Suspense boundary around
    // the whole app and opt every page out of static rendering. The effect only
    // runs in the browser, where window.location is already the truth.
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
 * The app shell with nothing in it yet, rather than a line of centred grey text.
 *
 * Both states are rare now that the session travels with the HTML, but they are
 * still what mock mode and an unreachable backend show, and a centred sentence
 * on an otherwise blank page reads as a broken app for however long it is up.
 * This puts a sidebar-width column and a page-shaped block where the real
 * layout will be, so arriving in the app is a fill rather than a redraw.
 *
 * The label is on the container and the blocks are aria-hidden, so a screen
 * reader hears the state once instead of walking a fence of empty divs.
 */
function SessionInterstitial({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen bg-background" role="status" aria-label={label}>
      {/* Nav-row blocks rather than an empty column. The sidebar is the part of
          this screen that is about to fill with the most content, so a blank
          panel is the biggest redraw on arrival. Widths vary because a column
          of identical bars reads as a loading GIF rather than as a list. */}
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
