import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'

// A word whose text is in this set is dropped from the mocked layout's 'end'
// payload, the same way d3-cloud itself drops a word it could not place. It
// is declared via vi.hoisted so the vi.mock factory below (hoisted above
// imports) can close over it, and tests can populate it before rendering.
const { omittedFromEnd } = vi.hoisted(() => ({ omittedFromEnd: new Set<string>() }))

// d3-cloud uses a canvas for collision detection, which jsdom lacks. Mock it as
// a chainable layout whose start() fires "end" with deterministic positions.
vi.mock('d3-cloud', () => {
  const factory = () => {
    let words: Array<{ text: string; size: number }> = []
    let endCb: (placed: unknown[]) => void = () => {}
    const layout = {
      size: () => layout,
      padding: () => layout,
      font: () => layout,
      fontSize: () => layout,
      rotate: () => layout,
      random: () => layout,
      words: (w: Array<{ text: string; size: number }>) => {
        words = w
        return layout
      },
      on: (_event: string, cb: (placed: unknown[]) => void) => {
        endCb = cb
        return layout
      },
      start: () => {
        const placed = words
          .filter((w) => !omittedFromEnd.has(w.text))
          .map((w, i) => ({ ...w, x: i * 10, y: i * 5, rotate: 0 }))
        endCb(placed)
        return layout
      },
      stop: () => layout,
    }
    return layout
  }
  return { default: factory }
})

import { resolveSeriesColor } from '@/lib/chart-colors'
import { FILLABLE_PANEL_HEIGHT } from '@/lib/chart-marks'
import { WordCloudRenderer } from './word-cloud-renderer'

// The box the svg is sized against. Read back through the svg rather than by
// class or test id, so the assertion still points at the right element if the
// wrapper's markup changes around it.
function sizingBoxOf(container: HTMLElement): HTMLElement {
  const box = container.querySelector('svg')?.parentElement
  if (!box) throw new Error('expected the svg to be wrapped in a sizing box')
  return box
}

function viz(options: Record<string, unknown>): MockVisualization {
  return { id: 1, type: 'WORD_CLOUD', name: 'Word Cloud', description: '', options, created_at: '', updated_at: '' }
}

const data: QueryResultData = {
  columns: [{ name: 'text', friendly_name: 'text', type: 'string' }],
  rows: [{ text: 'bus bus train' }],
}

// Every rendered <text> node's own textContent is its word, so tests can look
// a word up by label instead of relying on DOM order.
function textForWord(container: HTMLElement, word: string): Element {
  const nodes = Array.from(container.querySelectorAll('text'))
  const node = nodes.find((n) => n.textContent === word)
  if (!node) throw new Error(`expected a rendered <text> for word "${word}"`)
  return node
}

describe('WordCloudRenderer', () => {
  it('degrades to a muted message when the word column is unset', () => {
    render(<WordCloudRenderer visualization={viz({})} data={data} />)
    expect(screen.getByText(/requires a word column/i)).toBeInTheDocument()
  })

  it('renders the no-data state instead of an empty svg when the column is unset', () => {
    const { container } = render(<WordCloudRenderer visualization={viz({})} data={data} />)
    expect(container.querySelector('svg')).not.toBeInTheDocument()
  })

  it('renders the no-data state instead of an empty svg when filters exclude every word', () => {
    // column is set (so the first no-data branch does not fire), but a
    // wordCountLimit above every word's frequency drains buildWordCloudModel
    // down to an empty words list, exercising the model's other degraded
    // signal and the renderer's second no-data branch.
    const { container } = render(
      <WordCloudRenderer visualization={viz({ column: 'text', wordCountLimit: { min: 100 } })} data={data} />,
    )
    expect(screen.getByText(/no words to display/i)).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeInTheDocument()
  })

  it('never throws on a fully degraded input with no columns and no rows at all', () => {
    expect(() =>
      render(<WordCloudRenderer visualization={viz({})} data={{ columns: [], rows: [] }} />),
    ).not.toThrow()
    render(<WordCloudRenderer visualization={viz({ column: 'text' })} data={{ columns: [], rows: [] }} />)
    expect(screen.getAllByText(/word cloud requires a word column|no words to display/i)[0]).toBeInTheDocument()
  })

  it('renders each word as SVG text colored from the palette', async () => {
    const { container } = render(<WordCloudRenderer visualization={viz({ column: 'text' })} data={data} />)
    await waitFor(() => expect(container.querySelectorAll('text').length).toBe(2))
    expect(screen.getByText('bus')).toBeInTheDocument()
    expect(screen.getByText('train')).toBeInTheDocument()
    const fills = Array.from(container.querySelectorAll('text')).map((t) => t.getAttribute('fill'))
    expect(fills.every((f) => f?.startsWith('var(--chart-'))).toBe(true)
  })

  it('sizes each placed word by its own fontSize from the model, not a shared default', async () => {
    // "bus" appears twice and "train" once, so buildWordCloudModel scales
    // "bus" to the max font size (100) and "train" to the min (10); a single
    // shared size on every <text> would mean this renderer ignores the
    // model's per-word sizing entirely.
    const { container } = render(<WordCloudRenderer visualization={viz({ column: 'text' })} data={data} />)
    await waitFor(() => expect(container.querySelectorAll('text').length).toBe(2))
    const busNode = textForWord(container, 'bus')
    const trainNode = textForWord(container, 'train')
    expect(busNode.getAttribute('font-size')).toBe('100')
    expect(trainNode.getAttribute('font-size')).toBe('10')
  })

  it('assigns each word the exact palette color resolveSeriesColor gives its rank, not a shared fallback', async () => {
    const { container } = render(<WordCloudRenderer visualization={viz({ column: 'text' })} data={data} />)
    await waitFor(() => expect(container.querySelectorAll('text').length).toBe(2))
    const busFill = textForWord(container, 'bus').getAttribute('fill')
    const trainFill = textForWord(container, 'train').getAttribute('fill')
    // buildWordCloudModel sorts by count desc, so "bus" (count 2) lands at
    // rank 0 and "train" (count 1) at rank 1.
    expect(busFill).toBe(resolveSeriesColor('bus', 0))
    expect(trainFill).toBe(resolveSeriesColor('train', 1))
    expect(busFill).not.toBe(trainFill)
  })

  it('routes the mocked layout end-event positions to each word transform', async () => {
    const { container } = render(<WordCloudRenderer visualization={viz({ column: 'text' })} data={data} />)
    // The mocked d3-cloud layout places word i at x=i*10, y=i*5, rotate=0, so
    // its output must reach each node's transform. Nothing renders before
    // the end event fires, since only placed words are drawn.
    await waitFor(() =>
      expect(textForWord(container, 'train').getAttribute('transform')).toBe('translate(10, 5) rotate(0)'),
    )
    expect(textForWord(container, 'bus').getAttribute('transform')).toBe('translate(0, 0) rotate(0)')
  })

  // Sizing. jsdom runs no layout engine: every element is 0x0 there and no
  // stylesheet is resolved, so asserting a computed width would either read
  // back the attribute this component set or read back zero, and neither one
  // says whether the drawing scales. The honest assertion is on the attributes
  // that make the browser scale it, which is what these check.
  it('sizes the svg as a percentage of its box, not at a fixed pixel square', () => {
    const { container } = render(<WordCloudRenderer visualization={viz({ column: 'text' })} data={data} />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('100%')
    expect(svg?.getAttribute('height')).toBe('100%')
    // Named separately from the exact values above so a failure says WHICH
    // regression happened: an absolute length, bare number or px, is the shape
    // this renderer had before and the one it must not go back to.
    const ABSOLUTE_LENGTH = /^\d+(\.\d+)?(px)?$/
    expect(svg?.getAttribute('width')).not.toMatch(ABSOLUTE_LENGTH)
    expect(svg?.getAttribute('height')).not.toMatch(ABSOLUTE_LENGTH)
  })

  // Cross-model review found the hole this closes: width and height on an svg
  // are PRESENTATION attributes, which any CSS declaration outranks. So an
  // inline style, or a utility class pinning a size, silently wins in a browser
  // while every attribute assertion above stays green. Checking the attributes
  // alone was not enough to say the drawing scales.
  it('does not pin the svg size in CSS, which would outrank the percentage attributes', () => {
    const { container } = render(<WordCloudRenderer visualization={viz({ column: 'text' })} data={data} />)
    const svg = container.querySelector('svg')

    expect(svg?.style.width).toBe('')
    expect(svg?.style.height).toBe('')
    // A Tailwind w-/h- class is the same override wearing a different hat, and
    // the one a later edit is most likely to reach for.
    expect(svg?.getAttribute('class') ?? '').not.toMatch(/\b[wh]-\S+/)
  })

  it('keeps the viewBox that the percentage size scales against', () => {
    // A percentage-sized svg with no viewBox does not scale its contents, it
    // just gets a bigger canvas and draws the same 480-unit words in a corner,
    // so the two attributes are only meaningful together.
    const { container } = render(<WordCloudRenderer visualization={viz({ column: 'text' })} data={data} />)
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 480 480')
  })

  it('scales the layout uniformly and centres it in a box that is not square', () => {
    // meet, never slice: slice fills a non-square tile edge to edge by cropping
    // the viewBox, which here means silently dropping the words the layout
    // placed nearest the edges. xMid/yMid puts the leftover space on both
    // sides instead of pinning the square drawing to a corner.
    const { container } = render(<WordCloudRenderer visualization={viz({ column: 'text' })} data={data} />)
    const preserve = container.querySelector('svg')?.getAttribute('preserveAspectRatio')
    expect(preserve).toBe('xMidYMid meet')
    expect(preserve).not.toContain('slice')
  })

  it('gives the svg a definite height to resolve against without hardcoding pixels', () => {
    // The percentage height needs a containing block with a definite height,
    // and that height has to be the shared fill custom property rather than a
    // literal: a surface that opts into filling its space sets that property,
    // and a wrapper pinned to 400px would ignore it.
    const { container } = render(<WordCloudRenderer visualization={viz({ column: 'text' })} data={data} />)
    const box = sizingBoxOf(container)
    expect(box).toHaveStyle({ height: FILLABLE_PANEL_HEIGHT })
    expect(box.className).not.toMatch(/h-\[\d/)
  })

  it('does not render a word the mocked layout omits from its end payload', async () => {
    omittedFromEnd.add('train')
    try {
      const { container } = render(<WordCloudRenderer visualization={viz({ column: 'text' })} data={data} />)
      await waitFor(() => expect(container.querySelectorAll('text').length).toBe(1))
      expect(screen.getByText('bus')).toBeInTheDocument()
      expect(screen.queryByText('train')).not.toBeInTheDocument()
    } finally {
      omittedFromEnd.clear()
    }
  })
})
