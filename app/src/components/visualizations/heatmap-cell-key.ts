// The identity of one heatmap cell, derived from its two category values.
//
// This used to be `${x} ${y}`, written out by hand at ten separate call sites
// across the model, the renderer and both interaction hooks. Two different
// category pairs could produce one key: ('New York', 'West') and ('New',
// 'York West') both flattened to 'New York West', so the two cells aggregated
// into a single number, BOTH of them rendered it, and keyboard focus could
// resolve to the wrong DOM node through the same collision in cellRefs.
//
// The length prefix, not just a rarer separator, is what makes this injective
// for ARBITRARY category text. A category value is a database string: it can
// contain any character, so any encoding that relies on one character never
// appearing in the input is a smaller version of the same bug. Reading the key
// back: the digits before the first ':' are x's length, the next that many
// UTF-16 code units are x, and everything after that is y, whatever either of
// them contains (including ':' and leading digits).
//
// The key is runtime-only. It is a Map key in the model's `cells` and in the
// interaction hook's `cellRefs`, both rebuilt from `data` on every render, and
// it is never written to stored options JSON, a URL, a query param or storage,
// so changing its shape migrates nothing.
export function cellKey(x: string, y: string): string {
  return `${x.length}:${x}${y}`
}
