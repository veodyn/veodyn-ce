'use client'

import { useApplyTheme, useThemePreference } from '@/hooks/use-theme-preference'
import { ThemeScopeProvider, type ThemeScope } from '@veodyn/viz/components/theme/theme-scope'

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
    <ThemeScopeProvider scope={scope}>
      {/* display:contents, so the boundary is visible in the DOM without
          generating a box that affects layout. */}
      <div data-theme={scope} className="contents">
        {children}
      </div>
    </ThemeScopeProvider>
  )
}
