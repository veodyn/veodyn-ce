/**
 * Per-column display in a table: Redash's `displayAs`, plus the templates the
 * link and image kinds resolve against the row.
 *
 * `{{ column_name }}` reads another column of the same row and `{{ @ }}` reads
 * the column being rendered (viz-lib formatSimpleTemplate, and the prepareData
 * functions in shared/columns/link.tsx and image.tsx). An unknown name is left
 * as written, which is how a typo stays visible instead of turning into a
 * silently broken URL.
 */
import { describe, expect, it } from 'vitest'
import { formatColumnTemplate, resolveImageCell, resolveLinkCell } from './column-display'

const ROW = { camera_id: 'C12', label: 'North gate', missing: undefined }

describe('formatColumnTemplate', () => {
  it('substitutes another column of the same row', () => {
    expect(formatColumnTemplate('/cameras/{{ camera_id }}', ROW, 'C12')).toBe('/cameras/C12')
  })

  it('substitutes the current column with the at sign', () => {
    expect(formatColumnTemplate('/cameras/{{ @ }}', ROW, 'C12')).toBe('/cameras/C12')
  })

  it('tolerates missing whitespace', () => {
    expect(formatColumnTemplate('{{camera_id}}', ROW, 'C12')).toBe('C12')
  })

  it('substitutes several references in one template', () => {
    expect(formatColumnTemplate('{{ label }} ({{ @ }})', ROW, 'C12')).toBe('North gate (C12)')
  })

  // Leaving the tag visible is the point: a silently empty URL looks like the
  // data is missing rather than the template being wrong.
  it('leaves an unknown name as written', () => {
    expect(formatColumnTemplate('/x/{{ nope }}', ROW, 'C12')).toBe('/x/{{ nope }}')
  })

  it('is empty for a template that is not a string', () => {
    expect(formatColumnTemplate(undefined, ROW, 'C12')).toBe('')
  })
})

describe('resolveLinkCell', () => {
  it('builds an href from the url template', () => {
    const cell = resolveLinkCell(
      { name: 'camera_id', linkUrlTemplate: '/cameras/{{ @ }}' },
      ROW,
      'C12'
    )

    expect(cell).toMatchObject({ href: '/cameras/C12', text: '/cameras/C12' })
  })

  it('prefers the text template over showing the raw url', () => {
    const cell = resolveLinkCell(
      { name: 'camera_id', linkUrlTemplate: '/cameras/{{ @ }}', linkTextTemplate: '{{ label }}' },
      ROW,
      'C12'
    )

    expect(cell?.text).toBe('North gate')
  })

  it('opens in a new tab only when asked, and never without rel', () => {
    const plain = resolveLinkCell({ name: 'c', linkUrlTemplate: '/x' }, ROW, 'C12')
    const newTab = resolveLinkCell(
      { name: 'c', linkUrlTemplate: '/x', linkOpenInNewTab: true },
      ROW,
      'C12'
    )

    expect(plain?.target).toBeUndefined()
    expect(newTab?.target).toBe('_blank')
    // A target without this hands the opened page a handle on this one.
    expect(newTab?.rel).toBe('noopener noreferrer')
  })

  // No template, or one that resolves to nothing, means there is no link: the
  // cell falls back to plain text rather than rendering a dead anchor.
  it('is null when the url resolves to nothing', () => {
    expect(resolveLinkCell({ name: 'c' }, ROW, 'C12')).toBeNull()
    expect(resolveLinkCell({ name: 'c', linkUrlTemplate: '   ' }, ROW, 'C12')).toBeNull()
  })
})

describe('resolveImageCell', () => {
  it('builds a src from the url template', () => {
    const cell = resolveImageCell(
      { name: 'camera_id', imageUrlTemplate: '/snap/{{ @ }}.jpg' },
      ROW,
      'C12'
    )

    expect(cell).toMatchObject({ src: '/snap/C12.jpg' })
  })

  it('carries only positive sizes', () => {
    const cell = resolveImageCell(
      { name: 'c', imageUrlTemplate: '/x.jpg', imageWidth: '120', imageHeight: '0' },
      ROW,
      'C12'
    )

    expect(cell?.width).toBe(120)
    expect(cell?.height).toBeUndefined()
  })

  // alt is not optional for an image in a data table: without it a screen
  // reader gets a filename or nothing at all.
  it('uses the title template as the alt text', () => {
    const cell = resolveImageCell(
      { name: 'c', imageUrlTemplate: '/x.jpg', imageTitleTemplate: '{{ label }}' },
      ROW,
      'C12'
    )

    expect(cell?.alt).toBe('North gate')
  })

  it('falls back to an empty alt rather than inventing one', () => {
    const cell = resolveImageCell({ name: 'c', imageUrlTemplate: '/x.jpg' }, ROW, 'C12')

    expect(cell?.alt).toBe('')
  })

  it('is null when the url resolves to nothing', () => {
    expect(resolveImageCell({ name: 'c' }, ROW, 'C12')).toBeNull()
  })
})
