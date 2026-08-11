import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { required } from '@/lib/required'
import { CounterRenderer } from './counter-renderer'

function viz(options: Record<string, unknown>): MockVisualization {
  return {
    id: 1, type: 'COUNTER', name: 'Test counter', description: '',
    options, created_at: '2026-07-21T00:00:00Z', updated_at: '2026-07-21T00:00:00Z',
  }
}

const data: QueryResultData = {
  columns: [
    { name: 'vehicle_id', friendly_name: 'Vehicle', type: 'string' },
    { name: 'speed', friendly_name: 'Speed', type: 'float' },
  ],
  rows: [
    { vehicle_id: 'a', speed: 30 },
    { vehicle_id: 'b', speed: 45 },
    { vehicle_id: 'c', speed: 12 },
  ],
}

describe('CounterRenderer countRow', () => {
  it('shows the row count when countRow is true', () => {
    render(
      <CounterRenderer
        visualization={viz({ countRow: true, counterLabel: 'Active vehicles' })}
        data={data}
      />,
    )
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Active vehicles')).toBeInTheDocument()
  })

  it('counts rows even when no counterColName is set', () => {
    render(<CounterRenderer visualization={viz({ countRow: true })} data={{ columns: [], rows: [] }} />)
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('still reads a cell value when countRow is not set', () => {
    render(
      <CounterRenderer
        visualization={viz({ counterColName: 'speed', rowNumber: 2 })}
        data={data}
      />,
    )
    expect(screen.getByText('45')).toBeInTheDocument()
  })

  // jsdom does no layout, so this cannot assert the pixels that actually broke
  // (measured in a browser instead: the box was 24px around a 30px number).
  // What it CAN pin is the rule those pixels came from. `container-type: size`
  // means the box never grows to fit its children, so with `h-full` against an
  // auto-height parent (a report <figure>, the embed route) it collapses and
  // overflow-hidden crops the value. aspect-ratio is what gives it a definite
  // height there while staying inert under a definite-height parent. Dropping
  // either class silently reintroduces a clipped counter on every report.
  it('keeps an aspect ratio so a size-contained box cannot collapse under an auto-height parent', () => {
    const { container } = render(
      <CounterRenderer visualization={viz({ countRow: true })} data={data} />,
    )
    const box = required(
      container.querySelector('[class*="container-type:size"]'),
      'counter box',
    )

    expect(box.className).toContain('aspect-[4/1]')
    // h-full has to stay too: it is what makes the ratio yield in a dashboard
    // tile, where the parent does supply a height.
    expect(box.className).toContain('h-full')
  })

  // The other half of the fix. The ratio alone still cropped below ~600px of
  // width and in the smallest dashboard tile (~60px of content area, clipped
  // long before any of this). These drop the supporting lines rather than grow
  // the box, so the value itself is never the thing that gets cut.
  it('drops the label and trend rather than the value when the box is short', () => {
    const { container } = render(
      <CounterRenderer
        visualization={viz({ counterColName: 'speed', rowNumber: 1, targetValue: 40 })}
        data={data}
      />,
    )
    const box = required(container.querySelector('[class*="container-type:size"]'), 'counter box')
    const label = required(box.lastElementChild, 'counter label')

    expect(label.className).toContain('[@container_(max-height:4.5rem)]:hidden')
    // The value is the first child and carries no hide rule at any height.
    expect(required(box.firstElementChild, 'counter value').className).not.toContain('hidden')
  })
})

// A counter's caption is the one line of text it has, so a type name landing
// there costs the reader the only thing telling them what the number is. On
// /dashboards/15 the Current Weather panel read `86.56` over the word
// `Counter`, with no unit: degrees, humidity and wind speed all look like that.
describe('CounterRenderer caption', () => {
  function named(name: string): MockVisualization {
    return { ...viz({}), name }
  }

  it('does not caption the number with the type Redash named it after', () => {
    render(<CounterRenderer visualization={named('Counter')} data={data} />)

    expect(screen.queryByText('Counter')).not.toBeInTheDocument()
    // The column instead, which at least says what was measured.
    expect(screen.getByText('vehicle_id')).toBeInTheDocument()
  })

  it('keeps a name somebody actually wrote', () => {
    render(<CounterRenderer visualization={named('Active fleet vehicles')} data={data} />)

    expect(screen.getByText('Active fleet vehicles')).toBeInTheDocument()
  })

  it('still prefers the configured counterLabel over both', () => {
    render(
      <CounterRenderer
        visualization={{ ...viz({ counterLabel: 'Vehicles on the road' }), name: 'Counter' }}
        data={data}
      />
    )

    expect(screen.getByText('Vehicles on the road')).toBeInTheDocument()
  })
})
