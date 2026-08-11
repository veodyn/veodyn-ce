import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { SankeyRenderer, SankeyTooltip } from './sankey-renderer'

const visualization: MockVisualization = {
  id: 1,
  type: 'SANKEY',
  name: 'Sankey',
  description: '',
  options: {
    columnMapping: {
      from: 'source',
      to: 'target',
      amount: 'value',
    },
  },
  created_at: '',
  updated_at: '',
}

// recharts measures its container with getBoundingClientRect in a mount effect,
// and jsdom answers 0x0, so a ResponsiveContainer renders NOTHING here unless a
// test says how big the box is. Without this the file's first case rendered an
// empty div and asserted that doing so did not throw: SankeyNode never ran, and
// neither did the NaN guard that is the only reason it is written by hand.
// Probed before adding it: 0 svg, 0 rect, 0 text elements.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 640, height: 368, top: 0, left: 0, bottom: 368, right: 640, x: 0, y: 0,
    toJSON() { return this },
  } as DOMRect)
})

afterEach(() => vi.restoreAllMocks())

// A -> B -> C: three distinct endpoints, two links.
const flow: QueryResultData = {
  columns: [
    { name: 'from', friendly_name: 'From', type: 'string' },
    { name: 'to', friendly_name: 'To', type: 'string' },
    { name: 'amount', friendly_name: 'Amount', type: 'integer' },
  ],
  rows: [
    { from: 'A', to: 'B', amount: 2 },
    { from: 'B', to: 'C', amount: 1 },
  ],
}

describe('SankeyRenderer', () => {
  it('draws a node per distinct endpoint and a link per row', () => {
    const { container } = render(<SankeyRenderer visualization={visualization} data={flow} />)

    // A -> B and B -> C, so three nodes and two links. The node rects come from
    // SankeyNode, so this is also what covers its guard against the NaN
    // coordinates recharts hands it on a frame with no measured size.
    expect(container.querySelectorAll('.recharts-sankey-nodes rect')).toHaveLength(3)
    expect(container.querySelectorAll('.recharts-sankey-link')).toHaveLength(2)
    for (const name of ['A', 'B', 'C']) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
  })

  it('renders nothing rather than invalid SVG when the box has no size', () => {
    // The state the hand-written node renderer exists for: recharts passes NaN
    // coordinates on a frame it has not measured, and an unguarded renderer
    // emits <rect x="NaN">.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0, x: 0, y: 0,
      toJSON() { return this },
    } as DOMRect)

    const { container } = render(<SankeyRenderer visualization={visualization} data={flow} />)

    expect(container.querySelectorAll('rect')).toHaveLength(0)
    expect(container.innerHTML).not.toContain('NaN')
  })

  it('renders an empty state when there are insufficient columns', () => {
    const data: QueryResultData = {
      columns: [
        { name: 'from', friendly_name: 'From', type: 'string' },
        { name: 'to', friendly_name: 'To', type: 'string' },
      ],
      rows: [{ from: 'A', to: 'B' }],
    }

    render(<SankeyRenderer visualization={{ ...visualization, options: {} }} data={data} />)

    expect(screen.getByText('Sankey requires source, target, and value columns.')).toBeInTheDocument()
  })
})

// recharts' DEFAULT tooltip inlines `background-color: rgb(255,255,255)` and
// `border: 1px solid rgb(204,204,204)` as style attributes. No stylesheet
// reaches them and the viz-chrome guard cannot see them, because there is no
// class to check: in dark mode it was a white card on a dark chart. This file
// was the only chart in the repo still on the default.
// recharts' Payload type carries a graphicalItemId these cases never read, so
// it is filled once here rather than invented per case.
// The shape recharts actually hands a Sankey tooltip: it joins a link's ends
// into `name` itself and passes source/target as number INDEXES on the raw
// payload, which is why reading payload.source.name never worked.
function entry(name: string, value: number, payload: Record<string, unknown>) {
  return { name, value, payload, graphicalItemId: 'sankey' }
}

describe('SankeyTooltip', () => {
  it('names both ends of a link and carries no hardcoded colour', () => {
    const { container } = render(
      <SankeyTooltip
        active
        payload={[entry('A - B', 12, { source: 0, target: 1, value: 12 })]}
      />
    )

    expect(screen.getByText('A - B')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(container.firstElementChild).toHaveClass('bg-card')
    expect(container.innerHTML).not.toMatch(/rgb\(|#[0-9a-f]{3,6}/i)
  })

  it('names a node when the pointer is on one rather than on a link', () => {
    render(<SankeyTooltip active payload={[entry('C', 3, { name: 'C', value: 3 })]} />)

    expect(screen.getByText('C')).toBeInTheDocument()
  })

  it('renders nothing when it is not active or has no payload', () => {
    const { container: idle } = render(<SankeyTooltip payload={[entry('A - B', 1, {})]} />)
    const { container: empty } = render(<SankeyTooltip active payload={[]} />)

    expect(idle).toBeEmptyDOMElement()
    expect(empty).toBeEmptyDOMElement()
  })
})
