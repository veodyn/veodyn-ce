/**
 * Whether a value is something React can render as a component.
 *
 * Exists because `typeof x === 'function'` stopped being that test. Registered
 * Renderers and Editors are loaded on demand (see
 * lib/visualizations/lazy-components.ts), and `React.lazy` returns an OBJECT
 * carrying a `$$typeof` tag, not a function. Every assertion that a registered
 * type "has a renderer" was written as `toBeTypeOf('function')`, which would
 * now fail for a reason that has nothing to do with what it was guarding.
 *
 * This is the stronger check the originals were reaching for: it accepts a
 * function component, a lazy one, and a memo or forwardRef wrapper, and still
 * rejects the things those assertions existed to catch, which are a plugin
 * declaring no component at all and one declaring a string or a plain object.
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
