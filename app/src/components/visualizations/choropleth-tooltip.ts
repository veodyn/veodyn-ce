/**
 * The one line a choropleth shows for the region under the cursor, read off the
 * properties buildChoroplethModel wrote: `__key` labels it, `__value` is what
 * shades it. Empty when there is neither, so the caller can skip the popup.
 *
 * Plain text. The renderer passes it as a React text child, so a region name
 * out of a query result is shown rather than interpreted.
 */
export function choroplethTooltipText(properties: Record<string, unknown> | null | undefined): string {
  if (!properties) return ''
  const key = properties.__key
  const value = properties.__value
  const label = key == null || key === '' ? '' : String(key)
  // MapLibre round-trips properties through its own serialization, so a number
  // can arrive back as a string.
  const shown = value == null || value === '' ? '' : String(value)

  if (label && shown) return `${label}: ${shown}`
  if (label) return `${label}: no value`
  return shown
}
