'use client'

// Scopes one visualization to its own theme, for a widget whose appearance is
// a property of the panel rather than of the reader looking at it.
//
// Two things have to happen together. The tokens flip what every
// `bg-background` and `text-foreground` underneath resolves to; the context
// flips what renderers that cannot read CSS see (MapLibre picks a basemap URL,
// not a CSS variable). One without the other is a dark panel with a white map.
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

  // The common case needs no box: display:contents adds nothing that could take
  // part in layout, and every map in here sizes itself against its parent.
  if (theme === 'auto') {
    return (
      <div data-theme={resolved} className="contents">
        {children}
      </div>
    )
  }

  // Pinned, so this needs a real box: a custom property is inherited through a
  // display:contents element but a background cannot be painted by one. h-full
  // fills a definite-height panel; where it resolves to auto the children's own
  // min-h sizes the box.
  //
  // Tokens inline rather than a scope class: a nested scope class does not
  // survive this project's CSS pipeline (see widget-theme-palette.ts). The
  // `dark` class rides along so `dark:` variants still fire; it is additive.
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
