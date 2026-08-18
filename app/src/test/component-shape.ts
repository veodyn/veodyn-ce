/**
 * Whether a value is something React can render as a component.
 *
 * `typeof x === 'function'` is not that test: Renderers and Editors load on
 * demand (lib/visualizations/lazy-components.ts) and `React.lazy` returns an
 * object carrying a `$$typeof` tag. Accepts function, lazy, memo and forwardRef
 * components; rejects a string, a plain object, or no component at all.
 */
export function isRenderableComponent(value: unknown): boolean {
  if (typeof value === 'function') return true
  return (
    typeof value === 'object' &&
    value !== null &&
    '$$typeof' in value &&
    typeof (value as { $$typeof: unknown }).$$typeof === 'symbol'
  )
}
