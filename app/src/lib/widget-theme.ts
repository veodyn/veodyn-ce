// Per-visualization theme: whether a widget follows the reader or pins its own
// appearance.
//
// The reader's own light/dark choice lives in theme-preference.ts and is a
// property of the READER. This is a property of the WIDGET, saved in the
// visualization's options alongside its columns, and it exists because a panel
// on a control-room wall should look the same to everyone pointed at it. The
// app already has that idea for whole routes (forcedTheme() pins /wall and
// /present dark); this is the same idea at the size of one visualization.
//
// Pure, so the option parsing and the resolution rule stay testable without a
// DOM and cannot drift between the renderer and the editor that sets them.
import type { ResolvedTheme } from './theme-preference'

/** 'auto' follows the reader; the other two override them. */
export type WidgetTheme = 'auto' | 'light' | 'dark'

/** Menu order for any control that offers all three. */
export const WIDGET_THEMES: readonly WidgetTheme[] = ['auto', 'light', 'dark']

// Following the reader is the default, so a visualization saved before this
// existed, or by an author who never opened the control, behaves exactly as it
// did: no stored value means no override.
export const DEFAULT_WIDGET_THEME: WidgetTheme = 'auto'

export const WIDGET_THEME_LABELS: Readonly<Record<WidgetTheme, string>> = {
  auto: 'Follow the reader',
  light: 'Always light',
  dark: 'Always dark',
}

export function isWidgetTheme(value: unknown): value is WidgetTheme {
  return typeof value === 'string' && (WIDGET_THEMES as readonly string[]).includes(value)
}

/**
 * The theme stored on a visualization's options blob.
 *
 * Reads the raw options rather than a per-plugin resolved shape, so adding the
 * control to a plugin costs one import and not a change to its model. Anything
 * unrecognised (a hand-edited value, a key from an older build) reads as the
 * default rather than pinning a widget to a theme nobody chose.
 */
export function readWidgetTheme(options: unknown): WidgetTheme {
  if (options == null || typeof options !== 'object') return DEFAULT_WIDGET_THEME
  const value = (options as Record<string, unknown>).theme
  return isWidgetTheme(value) ? value : DEFAULT_WIDGET_THEME
}

/** What the widget actually renders as, once the reader's theme is known. */
export function resolveWidgetTheme(theme: WidgetTheme, appTheme: ResolvedTheme): ResolvedTheme {
  return theme === 'auto' ? appTheme : theme
}
