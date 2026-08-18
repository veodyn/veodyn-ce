// The identity of one heatmap cell, derived from its two category values.
//
// The length prefix keeps this injective for arbitrary category text: a category
// value is a database string, so a separator-only encoding collides ('New York',
// 'West') with ('New', 'York West'). Reading the key back: the digits before the
// first ':' are x's length, the next that many UTF-16 code units are x, and the
// rest is y. Runtime-only, never persisted, so its shape migrates nothing.
export function cellKey(x: string, y: string): string {
  return `${x.length}:${x}${y}`
}
