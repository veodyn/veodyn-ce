'use client'

import { createContext, useContext } from 'react'
import { useApplyTheme, useThemePreference } from '@/hooks/use-theme-preference'
import type { ResolvedTheme } from '@/lib/theme-preference'

export type ThemeScope = ResolvedTheme

const ThemeScopeContext = createContext<ThemeScope>('light')

/**
 * Owns the live theme: resolves it, puts it on <html>, and publishes it to the
 * components that cannot read CSS (useThemeScope, useThemeTokenVersion).
 *
 * `force` is for surfaces whose appearance belongs to the surface rather than
 * the reader: the print route, an embedded widget, the presentation screens.
 *
 * The token class belongs on the document element, not this wrapper: portalled
 * UI renders into document.body, so a dialog would inherit the wrong tokens.
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
      {/* display:contents, so the boundary is visible in the DOM without
          generating a box that affects layout. */}
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
 * Republishes the scope for one subtree that pins its own appearance.
 *
 * Context only: the matching token class has to sit on a real box for a
 * background to paint, so it is the caller's job. See widget-theme-boundary.tsx.
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
