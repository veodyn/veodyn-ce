// The two palettes, as data, for a widget that pins its own appearance.
//
// These are applied as inline custom properties by widget-theme-boundary.tsx
// rather than through a CSS class, and that is not the obvious choice, so:
// a nested `.dark` (or any new scope class) did not survive this project's CSS
// pipeline. The rules were in tokens.css and simply were not in any stylesheet
// the browser loaded, on any route, while `:root` and `.dark` from the same
// file came through. Several shapes were tried (a `:root, .light` selector
// list, a standalone class, a `@source inline(...)` safelist); a renamed probe
// class survived once and then stopped. Inline styles have none of that
// exposure: nothing scans, purges, reorders or merges them.
//
// The token set is exactly what `.dark` overrides in tokens.css. Anything it
// leaves alone is theme-independent and needs no entry here.
// widget-theme-palette.test.ts re-reads tokens.css and fails if these drift.

export type ThemeTokens = Readonly<Record<string, string>>

/** The tokens a theme switch changes. Everything else is theme-independent. */
export const THEME_TOKEN_NAMES: readonly string[] = [
  '--accent',
  '--accent-foreground',
  '--background',
  '--border',
  '--card',
  '--card-foreground',
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--chart-6',
  '--chart-7',
  '--chart-8',
  '--destructive',
  '--favorite',
  '--foreground',
  '--input',
  '--muted',
  '--muted-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--ring',
  '--scrollbar-thumb',
  '--scrollbar-thumb-hover',
  '--secondary',
  '--secondary-foreground',
  '--sidebar',
  '--sidebar-accent',
  '--sidebar-accent-foreground',
  '--sidebar-border',
  '--sidebar-foreground',
  '--sidebar-primary',
  '--sidebar-primary-foreground',
  '--sidebar-ring',
  '--status-fresh',
  '--status-stale',
]

export const LIGHT_TOKENS: ThemeTokens = {
  '--accent': '#EFEBE2',
  '--accent-foreground': '#1C1B18',
  '--background': '#F7F5F0',
  '--border': '#E5E1D8',
  '--card': '#FFFFFF',
  '--card-foreground': '#1C1B18',
  '--chart-1': '#485EA7',
  '--chart-2': '#2B7E4E',
  '--chart-3': '#A37AC7',
  '--chart-4': '#3570A2',
  '--chart-5': '#89435E',
  '--chart-6': '#BF8A32',
  '--chart-7': '#1D9999',
  '--chart-8': '#B25630',
  '--destructive': '#B4552D',
  '--favorite': '#C08A2D',
  '--foreground': '#1C1B18',
  '--input': '#E5E1D8',
  '--muted': '#F0EDE6',
  '--muted-foreground': '#6B6862',
  '--popover': '#FFFFFF',
  '--popover-foreground': '#1C1B18',
  '--primary': '#475569',
  '--primary-foreground': '#FFFFFF',
  '--ring': '#475569',
  '--scrollbar-thumb': '#D3CEC2',
  '--scrollbar-thumb-hover': '#B6B0A2',
  '--secondary': '#F0EDE6',
  '--secondary-foreground': '#1C1B18',
  '--sidebar': '#F7F5F0',
  '--sidebar-accent': '#EFEBE2',
  '--sidebar-accent-foreground': '#1C1B18',
  '--sidebar-border': '#E5E1D8',
  '--sidebar-foreground': '#1C1B18',
  '--sidebar-primary': '#1C1B18',
  '--sidebar-primary-foreground': '#F7F5F0',
  '--sidebar-ring': '#475569',
  '--status-fresh': '#2E7D4F',
  '--status-stale': '#94671F',
}

export const DARK_TOKENS: ThemeTokens = {
  '--accent': '#1A1F2B',
  '--accent-foreground': '#E7E9EE',
  '--background': '#0B0E14',
  '--border': 'rgba(255, 255, 255, 0.08)',
  '--card': '#12161F',
  '--card-foreground': '#E7E9EE',
  '--chart-1': '#4A61AA',
  '--chart-2': '#2B7E4E',
  '--chart-3': '#754998',
  '--chart-4': '#4D8FC8',
  '--chart-5': '#A05771',
  '--chart-6': '#BF861D',
  '--chart-7': '#1D9999',
  '--chart-8': '#B55933',
  '--destructive': '#E06A45',
  '--favorite': '#D9A441',
  '--foreground': '#E7E9EE',
  '--input': 'rgba(255, 255, 255, 0.12)',
  '--muted': '#1A1F2B',
  '--muted-foreground': '#9AA3B2',
  '--popover': '#12161F',
  '--popover-foreground': '#E7E9EE',
  '--primary': '#7FA9E0',
  '--primary-foreground': '#0B0E14',
  '--ring': '#7FA9E0',
  '--scrollbar-thumb': 'rgba(255, 255, 255, 0.16)',
  '--scrollbar-thumb-hover': 'rgba(255, 255, 255, 0.28)',
  '--secondary': '#1A1F2B',
  '--secondary-foreground': '#E7E9EE',
  '--sidebar': '#12161F',
  '--sidebar-accent': '#1A1F2B',
  '--sidebar-accent-foreground': '#E7E9EE',
  '--sidebar-border': 'rgba(255, 255, 255, 0.08)',
  '--sidebar-foreground': '#E7E9EE',
  '--sidebar-primary': '#E7E9EE',
  '--sidebar-primary-foreground': '#0B0E14',
  '--sidebar-ring': '#7FA9E0',
  '--status-fresh': '#4CAF7D',
  '--status-stale': '#D9A441',
}

export function themeTokens(theme: 'light' | 'dark'): ThemeTokens {
  return theme === 'dark' ? DARK_TOKENS : LIGHT_TOKENS
}
