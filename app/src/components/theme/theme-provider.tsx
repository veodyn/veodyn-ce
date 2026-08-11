'use client'

import { createContext, useContext } from 'react'
import { useApplyTheme, useThemePreference } from '@/hooks/use-theme-preference'
import type { ResolvedTheme } from '@/lib/theme-preference'

export type ThemeScope = ResolvedTheme

const ThemeScopeContext = createContext<ThemeScope>('light')

/**
 * Owns the live theme: resolves it, puts it on <html>, and publishes it to the
 * components that cannot read CSS (the toaster picks its own skin from
 * useThemeScope, and the WebGL renderers re-bake their colours off the class
 * through useThemeTokenVersion).
 *
 * `force` is for surfaces whose appearance belongs to the surface rather than
 * to the reader: the print route, an embedded widget, the presentation screens.
 * Everything else follows the reader's preference, which defaults to their OS.
 *
 * There is deliberately no `.dark` class on the wrapper below any more. It used
 * to carry one, and that left a documented hole: portalled UI renders into
 * document.body, so a dialog opened from a dark surface came up with light
 * tokens because CSS inheritance follows the DOM and not the React tree. The
 * class now lives on the document element, which every portal is inside.
 */
export function ThemeProvider({
  force,
  children,
}: {
  force?: ThemeScope
  children: React.ReactNode
}) {
  const { resolved } = useThemePreference()
  const scope = force ?? resolved

  useApplyTheme(scope)

  return (
    <ThemeScopeContext.Provider value={scope}>
      {/* display:contents, so this reads as a theme boundary in the DOM without
          becoming a box that could affect layout. */}
      <div data-theme={scope} className="contents">
        {children}
      </div>
    </ThemeScopeContext.Provider>
  )
}

export function useThemeScope(): ThemeScope {
  return useContext(ThemeScopeContext)
}

/**
 * Republishes the scope for one subtree, for a surface that pins its own
 * appearance below the app's.
 *
 * Only the context. The token class that goes with it is the caller's job,
 * because the two want different places in the DOM: the class has to sit on a
 * real box for a background to paint, and the context does not care. See
 * widget-theme-boundary.tsx, the one caller, which does both.
 */
export function ThemeScopeProvider({
  scope,
  children,
}: {
  scope: ThemeScope
  children: React.ReactNode
}) {
  return <ThemeScopeContext.Provider value={scope}>{children}</ThemeScopeContext.Provider>
}
