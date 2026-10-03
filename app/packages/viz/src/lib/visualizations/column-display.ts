/**
 * Per-column display for table results, mirroring Redash's `displayAs`.
 *
 * The link and image kinds resolve templates against the row: `{{ other_col }}`
 * reads another column and `{{ @ }}` reads the column being rendered. See
 * viz-lib formatSimpleTemplate and the prepareData functions in
 * shared/columns/link.tsx and image.tsx.
 */

/** The kinds handled here. Anything else falls back to plain text. */
export type ColumnDisplayAs = 'text' | 'number' | 'datetime' | 'boolean' | 'link' | 'image'

export interface ColumnDisplayOptions {
  name: string
  displayAs?: string
  linkUrlTemplate?: string
  linkTextTemplate?: string
  linkTitleTemplate?: string
  linkOpenInNewTab?: boolean
  imageUrlTemplate?: string
  imageTitleTemplate?: string
  imageWidth?: string
  imageHeight?: string
}

const TAG = /\{\{\s*([^\s{}]+?)\s*\}\}/g

/**
 * Resolves `{{ name }}` references against a row. An unknown name is left as
 * written, which is Redash's behaviour and the useful one: a silently empty URL
 * reads as missing data rather than as a template that needs fixing.
 */
export function formatColumnTemplate(
  template: string | undefined,
  row: Record<string, unknown>,
  currentValue: unknown
): string {
  if (typeof template !== 'string') return ''

  const scope: Record<string, unknown> = { ...row, '@': currentValue }
  return template.replace(TAG, (match, key: string) =>
    scope[key] === undefined || scope[key] === null ? match : String(scope[key])
  )
}

export interface LinkCell {
  href: string
  text: string
  title?: string
  target?: string
  rel?: string
}

export function resolveLinkCell(
  column: ColumnDisplayOptions,
  row: Record<string, unknown>,
  value: unknown
): LinkCell | null {
  const href = formatColumnTemplate(column.linkUrlTemplate, row, value).trim()
  // No template, or one that resolved to nothing, means there is no link here.
  // A dead anchor looks clickable and is not.
  if (!href) return null

  const text = formatColumnTemplate(column.linkTextTemplate, row, value).trim()
  const title = formatColumnTemplate(column.linkTitleTemplate, row, value).trim()

  return {
    href,
    text: text || href,
    ...(title ? { title } : {}),
    // rel travels with target, never apart from it: a _blank link without it
    // hands the opened page a handle on this one.
    ...(column.linkOpenInNewTab ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
  }
}

export interface ImageCell {
  src: string
  alt: string
  title?: string
  width?: number
  height?: number
}

function positiveInt(raw: string): number | undefined {
  const parsed = parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export function resolveImageCell(
  column: ColumnDisplayOptions,
  row: Record<string, unknown>,
  value: unknown
): ImageCell | null {
  const src = formatColumnTemplate(column.imageUrlTemplate, row, value).trim()
  if (!src) return null

  const title = formatColumnTemplate(column.imageTitleTemplate, row, value).trim()
  const width = positiveInt(formatColumnTemplate(column.imageWidth, row, value))
  const height = positiveInt(formatColumnTemplate(column.imageHeight, row, value))

  return {
    src,
    // Never absent. An image in a data table with no alt gives a screen reader
    // a filename or nothing; empty at least marks it decorative.
    alt: title,
    ...(title ? { title } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
  }
}
