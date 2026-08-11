import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CHART_FILL_VAR, ChartFrame, chartFrameHeight } from './chart-frame'

describe('chartFrameHeight', () => {
  it('reserves nothing for a legend below two series', () => {
    const withLegend = chartFrameHeight({ seriesCount: 2, hasAxisBand: true })
    const withoutLegend = chartFrameHeight({ seriesCount: 1, hasAxisBand: true })

    expect(withoutLegend).toBeLessThan(withLegend)
  })

  it('reserves the same band for one series as for none', () => {
    expect(chartFrameHeight({ seriesCount: 1, hasAxisBand: true })).toBe(
      chartFrameHeight({ seriesCount: 0, hasAxisBand: true }),
    )
  })

  it('grows by a row once the legend wraps', () => {
    const oneRow = chartFrameHeight({ seriesCount: 4, hasAxisBand: true })
    const twoRows = chartFrameHeight({ seriesCount: 5, hasAxisBand: true })

    expect(twoRows - oneRow).toBe(24)
  })

  it('reserves nothing for an axis band a pie does not have', () => {
    const withAxis = chartFrameHeight({ seriesCount: 3, hasAxisBand: true })
    const withoutAxis = chartFrameHeight({ seriesCount: 3, hasAxisBand: false })

    expect(withAxis - withoutAxis).toBe(32)
  })

  it('keeps the plot area itself constant as chrome is added', () => {
    // Every extra band is added to the frame, never taken out of the plot: a
    // chart with eight series has the same plot height as a chart with one.
    const bands = [
      chartFrameHeight({ seriesCount: 1, hasAxisBand: false }),
      chartFrameHeight({ seriesCount: 8, hasAxisBand: true }),
    ]

    expect(bands[1] - bands[0]).toBe(32 + 2 * 24)
  })

  it('keeps an ordinary chart no shorter than the fixed box it replaced', () => {
    // The old container was a flat 400px, which left about 338px of plot for
    // a one-series chart once the 32px padding and the axis band came out.
    // Sizing to content must not quietly shrink the ordinary chart, so this
    // pins an absolute floor rather than a delta between two calls.
    expect(chartFrameHeight({ seriesCount: 1, hasAxisBand: true })).toBeGreaterThanOrEqual(384)
  })
})

describe('ChartFrame', () => {
  it('sizes the box to its content', () => {
    render(
      <ChartFrame seriesCount={2} hasAxisBand>
        <span>plot</span>
      </ChartFrame>,
    )

    // The computed height is the FALLBACK now, not the value: a page that
    // wants its charts to fill the room it gave them sets --chart-frame-fill
    // on an ancestor and the var wins. Everywhere else this resolves to
    // exactly the number it always did.
    expect(screen.getByTestId('chart-frame')).toHaveStyle({
      height: `var(--chart-frame-fill, ${chartFrameHeight({ seriesCount: 2, hasAxisBand: true })}px)`,
    })
  })

  it('renders its chart', () => {
    render(
      <ChartFrame seriesCount={1}>
        <span>plot</span>
      </ChartFrame>,
    )

    expect(screen.getByText('plot')).toBeInTheDocument()
  })

  it('caps itself at a bounded parent instead of forcing a nested scrollbar', () => {
    // max-h-full (max-height: 100%) only resolves against a parent with a
    // definite height (a dashboard widget card); in an unbounded parent it
    // resolves to none and the inline height above still applies in full.
    // The inline height itself stays a plain style assertion elsewhere in
    // this file; this only pins that the capping class is present.
    render(
      <ChartFrame seriesCount={1}>
        <span>plot</span>
      </ChartFrame>,
    )

    expect(screen.getByTestId('chart-frame')).toHaveClass('max-h-full')
  })

  it('names the plot for assistive technology', () => {
    render(
      <ChartFrame seriesCount={2} hasAxisBand summary="Line chart. Series: a, b.">
        <span>plot</span>
      </ChartFrame>,
    )

    expect(screen.getByRole('img', { name: 'Line chart. Series: a, b.' })).toBeInTheDocument()
  })

  it('leaves the frame unnamed when no summary is supplied', () => {
    render(
      <ChartFrame seriesCount={2} hasAxisBand>
        <span>plot</span>
      </ChartFrame>,
    )

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('puts the image role on the plot wrapper, not the frame', () => {
    // role="img" makes every descendant presentational, so it must never sit
    // on the frame itself: anything added back beside the plot would be
    // silently hidden from assistive technology. The requirement is
    // structural, and containment is something jsdom genuinely sees.
    render(
      <ChartFrame seriesCount={2} hasAxisBand summary="Line chart. Series: a, b.">
        <span>plot</span>
      </ChartFrame>,
    )

    const frame = screen.getByTestId('chart-frame')
    expect(frame).not.toHaveAttribute('role', 'img')
    expect(frame).toContainElement(screen.getByRole('img'))
  })
})

// A chart on the standalone query page was 352px tall with 1318px of blank page
// under it, measured at 1825px of viewport: a 198-point series drawn in a fifth
// of the room it had, so every dip in it was a few pixels. Filling is opt-in,
// because the three surfaces that draw a chart in an unbounded parent do not
// want the same answer. The query page should fill; a report block is one of a
// stack at reading height and an embed is sized by whoever wrote the iframe.
describe('ChartFrame fill opt-in', () => {
  it('defers to an ancestor that asked for a height', () => {
    render(
      <div style={{ [CHART_FILL_VAR]: 'max(24rem, calc(100vh - 16rem))' } as React.CSSProperties}>
        <ChartFrame seriesCount={1}>
          <span>plot</span>
        </ChartFrame>
      </div>
    )

    // jsdom does not resolve custom properties inside a shorthand, so the
    // declaration is what can be asserted here. That the var actually WINS over
    // the fallback is CSS, verified in Chrome: the frame grew 644px at a 900px
    // viewport and 1344px at 1600px, while a bounded dashboard tile stayed 432
    // at both.
    expect(screen.getByTestId('chart-frame')).toHaveStyle({
      height: `var(--chart-frame-fill, ${chartFrameHeight({ seriesCount: 1 })}px)`,
    })
  })

  it('names the property in one place, so a caller cannot misspell it', () => {
    expect(CHART_FILL_VAR).toBe('--chart-frame-fill')
  })
})
