import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { getSequentialScale } from '@/lib/chart-colors'
import { HeatmapLegend } from './heatmap-legend'

describe('HeatmapLegend', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--card')
    document.documentElement.style.removeProperty('--chart-1')
  })

  it('builds its gradient bar from the same ramp the cells paint, not a hand-written gradient', () => {
    // Concrete tokens, distinct from chart-colors.ts's own fallback constants,
    // so a real CSS var read is exercised rather than a fallback standing in
    // for one. If the gradient were a hand-written CSS string instead of
    // built from getSequentialScale, it would drift from these and this
    // assertion would fail (a plain var(--card)-to-var(--chart-1) gradient,
    // for instance, has neither the SEQ_MIN_PCT floor nor the color-mix(in
    // oklab, ...) form the cells actually paint).
    document.documentElement.style.setProperty('--card', '#F6F4EE')
    document.documentElement.style.setProperty('--chart-1', '#0601FD')

    render(<HeatmapLegend min={0} max={100} valueLabel="Rides" clipped={false} />)

    const scale = getSequentialScale(0, 100)
    const gradientBar = screen.getByTestId('heatmap-legend-gradient')
    const backgroundImage = gradientBar.style.backgroundImage

    expect(backgroundImage.startsWith(`linear-gradient(to right, ${scale(0)}`)).toBe(true)
    expect(backgroundImage.endsWith(`${scale(100)})`)).toBe(true)
  })

  it('labels the domain floor, the domain ceiling, and what the magnitude is', () => {
    render(<HeatmapLegend min={3} max={5000} valueLabel="Rides" clipped={false} />)

    expect(screen.getByText('Rides')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('5.0K')).toBeInTheDocument()
  })

  it('announces the clip when clipped is true, and stays silent about it when clipped is false', () => {
    render(<HeatmapLegend min={0} max={10} valueLabel="Count" clipped={false} />)
    expect(screen.queryByText(/clipped/i)).not.toBeInTheDocument()
  })

  it('announces the clip when clipped is true', () => {
    render(<HeatmapLegend min={0} max={10} valueLabel="Count" clipped={true} />)
    expect(screen.getByText(/clipped/i)).toBeInTheDocument()
  })
})
