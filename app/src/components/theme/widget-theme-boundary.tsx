'use client'

// Scopes one visualization to its own theme, for a widget whose appearance is
// a property of the panel rather than of the reader looking at it.
//
// Two things have to happen together, which is why this is a component and not
// a hook. The token class flips what every `bg-background` and `text-foreground`
// underneath resolves to, and the context flips what the renderers that cannot
// read CSS see (MapLibre picks a basemap URL, not a CSS variable). Setting one
// without the other gives a dark panel with a blinding white map in it, which
// is the exact bug this was written to fix.
import { ThemeScopeProvider, useThemeScope } from './theme-provider'
import { resolveWidgetTheme, type WidgetTheme } from '@/lib/widget-theme'
import { themeTokens } from '@/lib/widget-theme-palette'

export interface WidgetThemeBoundaryProps {
  theme: WidgetTheme
  children: React.ReactNode
}

export function WidgetThemeBoundary({ theme, children }: WidgetThemeBoundaryProps) {
  const appTheme = useThemeScope()
  const resolved = resolveWidgetTheme(theme, appTheme)

  // Following the reader is the overwhelmingly common case, and it needs no
  // box at all: display:contents keeps the DOM honest about where the boundary
  // is without adding anything that could take part in layout. Worth the
  // branch, because every map in here sizes itself against its parent and a
  // stray box in that chain is what collapsed them all last time.
  if (theme === 'auto') {
    return (
      <div data-theme={resolved} className="contents">
        {children}
      </div>
    )
  }

  // Pinned, so this needs to be a real box: a custom property can be inherited
  // from a display:contents element, but a background cannot be painted by one,
  // and a dark widget whose panel stayed light would be worse than no feature.
  //
  // h-full fills a panel that has a definite height; where it resolves to auto
  // the children's own min-h gives the box its height, and the background
  // covers whatever that turns out to be.
  //
  // The tokens are inline rather than a scope class. That is deliberate and the
  // reasoning is in widget-theme-palette.ts: a nested scope class did not
  // survive this project's CSS pipeline, on any route, in any of the shapes it
  // was tried in. Inline properties are not scanned, purged, merged or
  // reordered, and `bg-background` reads `var(--background)` directly, so
  // setting the raw tokens here is all the utilities beneath need.
  //
  // The `dark` class rides along so `dark:` variants inside a pinned-dark panel
  // still fire. It is additive: without it the tokens below still do the work.
  return (
    <ThemeScopeProvider scope={resolved}>
      <div
        data-theme={resolved}
        className={
          resolved === 'dark'
            ? 'dark h-full w-full bg-background text-foreground'
            : 'h-full w-full bg-background text-foreground'
        }
        style={themeTokens(resolved) as React.CSSProperties}
      >
        {children}
      </div>
    </ThemeScopeProvider>
  )
}
