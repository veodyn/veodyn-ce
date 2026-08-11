import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChartLegend } from './chart-legend'

const payload = [
  { value: 'Revenue', color: 'var(--chart-1)' },
  { value: 'Cost', color: 'var(--chart-2)' },
]

describe('ChartLegend', () => {
  it('names every series', () => {
    render(<ChartLegend payload={payload} />)

    expect(screen.getByText('Revenue')).toBeInTheDocument()
    expect(screen.getByText('Cost')).toBeInTheDocument()
  })

  it('carries the series colour on the swatch, never on the label', () => {
    render(<ChartLegend payload={payload} />)

    const label = screen.getByText('Revenue')
    expect(label).toHaveClass('text-muted-foreground')
    expect(label.getAttribute('style')).toBeNull()

    const swatch = label.parentElement?.querySelector('[data-slot="legend-swatch"]')
    expect(swatch).toHaveStyle({ backgroundColor: 'var(--chart-1)' })
  })

  it('hides the swatch from assistive tech, since the label carries the name', () => {
    render(<ChartLegend payload={payload} />)

    const swatch = screen.getByText('Revenue').parentElement?.querySelector('[data-slot="legend-swatch"]')
    expect(swatch).toHaveAttribute('aria-hidden', 'true')
  })

  it('is exposed to assistive technology as a labelled list', () => {
    render(<ChartLegend payload={payload} />)

    const list = screen.getByRole('list', { name: 'Chart legend' })
    expect(list).toBeInTheDocument()
    expect(list).not.toHaveAttribute('tabindex')
  })

  it('renders nothing without a payload', () => {
    const { container } = render(<ChartLegend />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for an empty payload', () => {
    const { container } = render(<ChartLegend payload={[]} />)

    expect(container).toBeEmptyDOMElement()
  })
})
