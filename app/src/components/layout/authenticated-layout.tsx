'use client'

import { usePathname } from 'next/navigation'
import { SessionProvider } from '@/components/auth/session-provider'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { ThemeProvider } from '@/components/theme/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { OfflineBanner } from '@/components/shared/offline-banner'
import { CommandPaletteProvider } from '@/components/search/command-palette-provider'
import { forcedTheme } from '@/lib/theme-preference'
import { featureRouteFor } from '@/features'

export function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  const isEmbed = pathname.startsWith('/embed/')
  const isPublicDashboard = pathname.startsWith('/dashboards/public/')
  // Bounded to the /reports/public/ segment, with the trailing slash, so the
  // analyst routes (/reports, /reports/<id>, /reports/publications) keep their
  // chrome and only an unlisted link renders bare. This stays hardcoded even
  // though it names reports: it serves people with no account at all, and it
  // must keep working even in a build with no reports feature installed, so
  // it cannot be sourced from that feature's registry entry. Do not "finish
  // the job" and fold this into the registry, or anonymous access breaks the
  // day the reports package is absent.
  const isPublicReport = pathname.startsWith('/reports/public/')
  const isTokenPage = pathname.startsWith('/invite/') || pathname.startsWith('/reset/')
  // The sign-in route cannot sit inside SessionProvider: that is the provider
  // that redirects here, and nesting them would loop.
  const isLogin = pathname === '/login'

  // The report print route and the wall/present routes are feature-owned:
  // both are chrome-free but still authenticated, so they share one branch
  // below rather than joining the anonymous bypass above (which skips
  // SessionProvider). With no reports or wall package installed,
  // featureRouteFor finds nothing here and the path falls through to the
  // default shell instead.
  const featureRoute = featureRouteFor(pathname)

  // This boolean decides the SHELL. The theme is a separate question with a
  // separate answer: forcedTheme() names the surfaces whose appearance is not
  // the reader's to choose (print, embed, the presentation screens), and
  // everything else follows their light/dark preference. ThemeProvider handles
  // the rest, including putting the class on <html> so portals inherit it.
  const forced = forcedTheme(pathname) ?? undefined

  if (isEmbed || isPublicDashboard || isPublicReport || isTokenPage || isLogin) {
    return (
      <ThemeProvider force={forced}>
        <main className="min-h-screen">
          {children}
          <Toaster />
        </main>
      </ThemeProvider>
    )
  }

  if (featureRoute?.bareChrome) {
    return (
      <ThemeProvider force={forced}>
        <SessionProvider>
          <main className="min-h-screen bg-background text-foreground">{children}</main>
          <Toaster />
        </SessionProvider>
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider force={forced}>
      <SessionProvider>
        <OfflineBanner />
        <CommandPaletteProvider />
        <div className="flex min-h-screen bg-background text-foreground">
          <AppSidebar />
          <div className="flex min-w-0 flex-1 flex-col mt-14 md:mt-0">
            <main className="flex-1">{children}</main>
          </div>
        </div>
        <Toaster />
      </SessionProvider>
    </ThemeProvider>
  )
}
