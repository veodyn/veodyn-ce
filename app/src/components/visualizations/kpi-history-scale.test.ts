import { describe, expect, it } from 'vitest'
import type { MetricTarget, MetricThresholds } from '@/types/metric'
import { historyScale, statusBands } from './kpi-history-scale'

// The reading that produced this file. Average Rail Speed by Line on stage:
// breached at 1.584 mph against a target of 25, and the chart drew it climbing
// to the top of its box because the domain was the series' own range.
const RAIL_SPEEDS = [1.31, 1.42, 1.5, 1.55, 1.582, 1.584]
const HIGHER: MetricTarget = { value: 25, direction: 'higher-is-better' }
const HIGHER_BANDS: MetricThresholds = { atRisk: 22.5, breached: 20 }

const LOWER: MetricTarget = { value: 200, direction: 'lower-is-better' }
const LOWER_BANDS: MetricThresholds = { atRisk: 250, breached: 400 }

describe('historyScale', () => {
  it('always contains the target, however far the readings are from it', () => {
    const { domain: [min, max] } = historyScale(RAIL_SPEEDS, HIGHER, HIGHER_BANDS)

    expect(min).toBeLessThan(1.31)
    expect(max).toBeGreaterThan(25)
  })

  it('leaves the breached series near the floor instead of filling the box', () => {
    const { domain: [min, max] } = historyScale(RAIL_SPEEDS, HIGHER, HIGHER_BANDS)

    // The misread this fixes: at 6% of target the line must sit low, not
    // plateau at the top. Where the last reading falls in the box, 0 = floor.
    const position = (1.584 - min) / (max - min)
    expect(position).toBeLessThan(0.15)
  })

  it('floors at zero rather than showing speeds that cannot happen', () => {
    // Snapping outward to a step of 10 put the floor at -10 for a KPI reading
    // 1.3 mph, which spent a quarter of the box below zero and pushed the
    // series back toward the middle, undoing the fix above.
    const { domain } = historyScale(RAIL_SPEEDS, HIGHER, HIGHER_BANDS)

    expect(domain[0]).toBe(0)
  })

  it('keeps a negative floor when the KPI genuinely goes negative', () => {
    const { domain } = historyScale(
      [-4, -1, 2],
      { value: 5, direction: 'higher-is-better' },
      { atRisk: 3, breached: 0 }
    )

    expect(domain[0]).toBeLessThan(-4)
  })

  it('contains both thresholds too, so neither rule is drawn off-screen', () => {
    const { domain: [min, max] } = historyScale([300], LOWER, LOWER_BANDS)

    expect(min).toBeLessThan(200)
    expect(max).toBeGreaterThan(400)
  })

  it('gives a flat series at target a real height rather than a zero span', () => {
    const { domain: [min, max] } = historyScale([25, 25, 25], HIGHER, { atRisk: 25, breached: 25 })

    // Every mark identical: a zero-height domain renders as one line pinned to
    // the top of the box, which is exactly the picture this file exists to stop.
    expect(max).toBeGreaterThan(min)
    expect(min).toBeLessThan(25)
    expect(max).toBeGreaterThan(25)
  })

  it('spaces its gridlines evenly and lands them on round numbers', () => {
    // Left to recharts, a domain of [75, 90] came back as 75 / 78.75 / 82.5 /
    // 86.25 / 90, which the formatter rounded to 75 / 79 / 83 / 87 / 90: an
    // axis that looks linear and is not. Worse than ugly numbers, because a
    // reader measures the gap between the line and the target off these.
    const { domain, ticks } = historyScale([82, 88], HIGHER, { atRisk: 85, breached: 78 })

    expect(ticks[0]).toBe(domain[0])
    expect(ticks[ticks.length - 1]).toBe(domain[1])
    const gaps = ticks.slice(1).map((tick, i) => tick - ticks[i])
    expect(new Set(gaps.map((g) => g.toFixed(6))).size).toBe(1)
  })

  it('keeps a fractional step exact rather than accumulating a float error', () => {
    const { ticks } = historyScale([0.42, 0.58], { value: 0.5, direction: 'higher-is-better' }, { atRisk: 0.48, breached: 0.4 })

    // Accumulated addition leaves ticks like 0.30000000000000004, which the
    // axis renders and the top gridline misses the frame by an epsilon.
    for (const tick of ticks) {
      expect(String(tick)).not.toMatch(/\d{10,}/)
    }
  })

  it('survives a KPI whose readings and target are all zero', () => {
    const { domain: [min, max] } = historyScale([0], { value: 0, direction: 'higher-is-better' }, { atRisk: 0, breached: 0 })

    expect(max).toBeGreaterThan(min)
    expect(Number.isFinite(min) && Number.isFinite(max)).toBe(true)
  })
})

describe('statusBands', () => {
  it('puts the breach at the bottom when higher is better', () => {
    const { domain } = historyScale(RAIL_SPEEDS, HIGHER, HIGHER_BANDS)
    const bands = statusBands(domain, HIGHER, HIGHER_BANDS)

    expect(bands.map((b) => b.status)).toEqual(['breached', 'at-risk', 'on-track'])
    expect(bands[0].from).toBe(domain[0])
    expect(bands[0].to).toBe(20)
    expect(bands[2].to).toBe(domain[1])
  })

  it('puts the breach at the top when lower is better', () => {
    // Shading the healthy half red is worse than not shading at all, so the
    // flip gets its own case rather than riding on the one above.
    const { domain } = historyScale([180, 300], LOWER, LOWER_BANDS)
    const bands = statusBands(domain, LOWER, LOWER_BANDS)

    expect(bands.map((b) => b.status)).toEqual(['on-track', 'at-risk', 'breached'])
    expect(bands[2].from).toBe(400)
    expect(bands[2].to).toBe(domain[1])
  })

  it('covers the whole domain with no gap between bands', () => {
    const { domain } = historyScale(RAIL_SPEEDS, HIGHER, HIGHER_BANDS)
    const bands = statusBands(domain, HIGHER, HIGHER_BANDS)

    expect(bands[0].from).toBe(domain[0])
    for (let i = 1; i < bands.length; i += 1) {
      expect(bands[i].from).toBe(bands[i - 1].to)
    }
    expect(bands[bands.length - 1].to).toBe(domain[1])
  })

  it('drops a band with no height rather than drawing it as a hairline', () => {
    // Coinciding thresholds leave the at-risk band empty. recharts strokes a
    // zero-height ReferenceArea as a line, which reads as a third rule.
    const domain: [number, number] = [0, 50]
    const bands = statusBands(domain, HIGHER, { atRisk: 20, breached: 20 })

    expect(bands.map((b) => b.status)).toEqual(['breached', 'on-track'])
  })
})
