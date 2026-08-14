import type { Metadata } from 'next'
import { headers } from 'next/headers'
import './globals.css'
import { Providers } from './providers'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'
import { config } from '@/lib/config'
import { toClientConfig } from '@/lib/config-schema'
import { appFontClassName, fontStyleFromConfig } from '@/lib/font-registry'
import { telemetryClientConfig } from '@/lib/observability/serverConfig'
import { readServerSession } from '@/lib/server-session'
import { themeInitScript } from '@/lib/theme-preference'
import { themeStyle } from '@/lib/theme-style'

// Config is read from mounted YAML and VEODYN_* env vars at server start, not
// baked in at build time, so this route must render at request time rather
// than be frozen into the static prerender.
export const dynamic = 'force-dynamic'

export function generateMetadata(): Metadata {
  return {
    title: config.brand.name,
    description: config.home.tagline,
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Read here, on the server, rather than from an effect after hydration. The
  // session cookie is already on this request (src/middleware.ts reads it to
  // decide whether to serve the page at all), and asking Redash from inside the
  // cluster replaces a client round trip that could only start once ~390 KB of
  // JavaScript had downloaded and hydrated. See src/lib/server-session.ts for
  // what each answer means, including why it may decline to decide.
  const initialSession = await readServerSession()

  // The CSP that middleware attached to this response is nonce-based with
  // strict-dynamic, so an inline script it did not authorise does not run. Next
  // stamps its own script tags automatically; the hand-written one below is not
  // one of those, and without this it is silently blocked and the theme flash
  // it exists to prevent comes back.
  const nonce = (await headers()).get('x-nonce') ?? undefined

  return (
    // suppressHydrationWarning because the script below writes `class` and
    // `data-theme` on this element before React hydrates, so the client DOM is
    // deliberately not the markup the server sent. It suppresses the warning
    // for this element's own attributes only, not for the tree inside it.
    <html
      lang="en"
      className={appFontClassName}
      style={fontStyleFromConfig(config.theme.fonts)}
      suppressHydrationWarning
    >
      <body className="antialiased font-sans">
        {/* First child of <body>, before anything paintable: this runs
            synchronously during parsing and settles the theme, so a reader who
            prefers dark never sees the light page flash past while the bundle
            loads. The server cannot do this for them, since the preference
            lives in localStorage and the OS setting is only knowable here. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
        <style dangerouslySetInnerHTML={{ __html: themeStyle(config) }} />
        {/* Telemetry config travels as a prop rather than a NEXT_PUBLIC_ var so
            it is read per request. This route is already force-dynamic, so one
            image serves stage with telemetry on and prod with it off. */}
        <Providers
          config={toClientConfig(config)}
          telemetry={telemetryClientConfig()}
          initialSession={initialSession}
        >
          <AuthenticatedLayout>{children}</AuthenticatedLayout>
        </Providers>
      </body>
    </html>
  )
}
