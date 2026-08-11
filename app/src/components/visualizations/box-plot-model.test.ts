import { describe, expect, it } from 'vitest'
import { computeAxisTicks, computeBoxPlotDomain, computeBoxStats, describeBox } from './box-plot-model'

const box = (category: string, values: number[]) => computeBoxStats(category, values)

describe('computeBoxPlotDomain', () => {
  // The defect this replaced was Math.min(...values, 0): a measure that lives
  // far from zero got an axis starting at zero and every box was squeezed into
  // the top of the plot.
  it('brackets the data rather than reaching down to zero', () => {
    const { domainMin, domainMax } = computeBoxPlotDomain([box('corridor', [22, 30, 40, 55, 93])])

    expect(domainMin).toBeGreaterThan(0)
    expect(domainMin).toBeLessThan(22)
    expect(domainMax).toBeGreaterThan(93)
  })

  it('contains zero when the distribution straddles it', () => {
    const { domainMin, domainMax } = computeBoxPlotDomain([box('delta', [-8, -3, 0, 4, 9])])

    expect(domainMin).toBeLessThan(0)
    expect(domainMax).toBeGreaterThan(0)
  })

  it('includes an outlier, which sits outside the whiskers', () => {
    const { domainMax } = computeBoxPlotDomain([box('corridor', [1, 2, 2, 3, 3, 4, 40])])

    expect(domainMax).toBeGreaterThan(40)
  })

  it('gives a distribution with no spread at all a domain it can be drawn in', () => {
    const { domainMin, domainMax } = computeBoxPlotDomain([box('flat', [7, 7, 7])])

    expect(domainMax).toBeGreaterThan(domainMin)
    expect(domainMin).toBeLessThan(7)
    expect(domainMax).toBeGreaterThan(7)
  })
})

describe('computeAxisTicks', () => {
  it('labels round values inside the domain, not the padded endpoints', () => {
    expect(computeAxisTicks(18.45, 96.55)).toEqual([20, 40, 60, 80])
  })

  it('always lands on zero when the domain crosses it', () => {
    expect(computeAxisTicks(-8.85, 9.85)).toContain(0)
  })

  it('never returns an empty axis for a degenerate domain', () => {
    expect(computeAxisTicks(5, 5)).toEqual([5])
  })
})

describe('describeBox', () => {
  it('reads out the five-number summary a box plot draws but never writes', () => {
    expect(describeBox(box('A', [1, 3, 5]))).toBe('A: Max 5, Q3 4, Median 3, Q1 2, Min 1')
  })

  it('counts the outliers, so a lone dot is accounted for', () => {
    expect(describeBox(box('A', [1, 2, 2, 3, 3, 4, 40]))).toContain('1 outlier: 40')
  })
})
