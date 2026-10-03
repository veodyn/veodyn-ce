import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChartTooltip } from './chart-tooltip'

// recharts only mounts tooltip content while a point is active, and jsdom does
// no layout, so its pointer maths can never resolve one here. The content
// component is what a hover renders, so it is exercised directly; that a hover
// reaches it at all is covered in a browser.
// recharts' own payload entry carries more than a tooltip reads (a
// graphicalItemId among it), so this is the shape it hands the component with
// the rest of that type's requirements satisfied at the call sites below.
const payload = [{ dataKey: 'value', name: 'value', value: 42, color: '#000', graphicalItemId: 'value' }]

const ISO_LIKE = { dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' }
const EUROPEAN_TWELVE_HOUR = { dateFormat: 'DD/MM/YYYY', timeFormat: 'hh:mm A' }

describe('ChartTooltip', () => {
  it('names a datetime x value in the configured format', () => {
    // The axis under this tooltip is labelled from the same setting (see
    // x-axis-datetime-renderers.test.tsx), so a tooltip on its own form would
    // have the chart naming one instant two ways.
    render(
      <ChartTooltip
        active
        payload={payload}
        label="2026-07-25T21:00:00"
        xIsDatetime
        xHasTime
        patterns={EUROPEAN_TWELVE_HOUR}
      />,
    )

    expect(screen.getByText('25/07/2026 09:00 PM')).toBeInTheDocument()
  })

  it('shows the date alone for a column with no clock time in it', () => {
    render(
      <ChartTooltip active payload={payload} label="2026-07-25" xIsDatetime patterns={EUROPEAN_TWELVE_HOUR} />,
    )

    expect(screen.getByText('25/07/2026')).toBeInTheDocument()
  })

  it('leaves a non-datetime x label exactly as the query returned it', () => {
    // A category axis holds strings the setting has nothing to say about, and
    // running one through a date formatter is how "Firefox" becomes a date.
    render(<ChartTooltip active payload={payload} label="Firefox" patterns={ISO_LIKE} />)

    expect(screen.getByText('Firefox')).toBeInTheDocument()
  })
})
