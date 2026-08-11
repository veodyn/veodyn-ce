import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import { renderWithProviders, resetStores } from '@/test/utils'
import { StatNumber } from './stat-number'
import { useReducedMotion } from '@/hooks/use-reduced-motion'

// jsdom does not implement window.matchMedia at all (it is `undefined`), so
// the real useReducedMotion() hook falls back to its "matchMedia unavailable"
// branch and reports `true` (reduced) by default in every test in this repo,
// not `false` as a naive reading of "default jsdom" might suggest. To get
// deterministic coverage of BOTH the short-circuit path and the real rAF
// count-up path in one file, the hook module is mocked with a controllable
// return value: the first describe block below pins it to `true` (matches
// the actual jsdom default anyway), and the second pins it to `false` to
// exercise the animation path without depending on jsdom's absent
// matchMedia implementation.
vi.mock('@/hooks/use-reduced-motion', () => ({
  useReducedMotion: vi.fn(() => true),
}))

afterEach(() => {
  resetStores()
  vi.mocked(useReducedMotion).mockReturnValue(true)
})

describe('StatNumber (reduced motion, deterministic)', () => {
  it('renders the final value formatted with toLocaleString and the label', () => {
    renderWithProviders(<StatNumber value={1234567} label="Active Feeds" />)

    expect(screen.getByText('Active Feeds')).toBeInTheDocument()
    expect(screen.getByText('1,234,567')).toBeInTheDocument()
  })

  it('renders the value in the mono tabular-nums role', () => {
    renderWithProviders(<StatNumber value={42} label="Count" />)

    const value = screen.getByText('42')
    expect(value).toHaveClass('font-mono', 'tabular-nums')
  })

  it('renders a DeltaChip when delta is provided', () => {
    renderWithProviders(<StatNumber value={99} unit="%" delta={3.2} />)

    const chip = screen.getByText(/\+3\.2%/)
    expect(chip).toBeInTheDocument()
    expect(chip.querySelector('svg')).toHaveClass('lucide-arrow-up')
  })

  it('does not render a DeltaChip when delta is not provided', () => {
    renderWithProviders(<StatNumber value={99} />)
    expect(screen.queryByText(/^[+-]/)).not.toBeInTheDocument()
  })

  it('renders a fill-bar proportional to value/target when target is provided', () => {
    renderWithProviders(<StatNumber value={82} target={100} label="Quota" />)

    const bar = screen.getByTestId('stat-fillbar')
    expect(bar).toHaveStyle({ width: '82%' })
  })

  it('clamps the fill-bar width to 100% when value exceeds target', () => {
    renderWithProviders(<StatNumber value={150} target={100} />)

    const bar = screen.getByTestId('stat-fillbar')
    expect(bar).toHaveStyle({ width: '100%' })
  })

  it('clamps the fill-bar width to 0% when value is negative', () => {
    renderWithProviders(<StatNumber value={-10} target={100} />)

    const bar = screen.getByTestId('stat-fillbar')
    expect(bar).toHaveStyle({ width: '0%' })
  })

  it('does not render a fill-bar when target is not provided', () => {
    renderWithProviders(<StatNumber value={82} />)
    expect(screen.queryByTestId('stat-fillbar')).not.toBeInTheDocument()
  })

  it('appends % directly for a percent unit', () => {
    renderWithProviders(<StatNumber value={99} unit="%" />)
    expect(screen.getByText('99%')).toBeInTheDocument()
  })

  it('renders other units after a space', () => {
    renderWithProviders(<StatNumber value={142} unit="ms" />)
    expect(screen.getByText(/142\s*ms/)).toBeInTheDocument()
  })

  it('renders the exact non-integer settled value instead of rounding it away', () => {
    // Under the old maximumFractionDigits: 1 rule, 99.95 rounds to "100",
    // silently misreporting the actual value. The settled display (reduced
    // motion short-circuits straight to `value`) must show it exactly.
    renderWithProviders(<StatNumber value={99.95} label="Uptime" />)
    expect(screen.getByText('99.95')).toBeInTheDocument()
    expect(screen.queryByText('100')).not.toBeInTheDocument()
  })
})

describe('StatNumber (real motion path, rAF count-up)', () => {
  afterEach(() => {
    vi.mocked(useReducedMotion).mockReturnValue(true)
  })

  it('animates to and settles on the final value via the rAF loop', async () => {
    vi.mocked(useReducedMotion).mockReturnValue(false)
    renderWithProviders(<StatNumber value={250} label="Live" />)

    expect(await screen.findByText('250')).toBeInTheDocument()
  })

  it('replays the refresh pulse when refreshKey changes without hanging', async () => {
    vi.mocked(useReducedMotion).mockReturnValue(false)
    const { rerender } = renderWithProviders(<StatNumber value={10} refreshKey={1} />)
    expect(await screen.findByText('10')).toBeInTheDocument()

    rerender(<StatNumber value={20} refreshKey={2} />)
    expect(await screen.findByText('20')).toBeInTheDocument()
  })
})

describe('StatNumber (hydration flip and edge cases)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.mocked(useReducedMotion).mockReturnValue(true)
  })

  it('re-runs the count-up from 0 after the reduced-motion true to false flip', () => {
    // Drive rAF manually so the assertion is deterministic, not timing-based.
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb)
      return frames.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    let clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)

    // Hydration render: useReducedMotion's server/hydration snapshot is `true`.
    vi.mocked(useReducedMotion).mockReturnValue(true)
    const { rerender } = renderWithProviders(<StatNumber value={1000} label="Movers" />)
    expect(screen.getByText('1,000')).toBeInTheDocument()

    // Post-hydration correction to the real (unreduced) preference. The effect
    // captures start = performance.now() = 0 here and schedules one frame.
    vi.mocked(useReducedMotion).mockReturnValue(false)
    rerender(<StatNumber value={1000} label="Movers" />)

    // Mid-animation frame: the count-up climbs from 0, so the shown value is
    // below the final. Without the from=0 fix it would stay pinned at 1,000.
    clock = 180
    act(() => {
      frames.shift()?.(clock)
    })
    expect(screen.queryByText('1,000')).not.toBeInTheDocument()

    // Final frame: it settles exactly on the final value.
    clock = 360
    act(() => {
      let cb = frames.shift()
      while (cb) {
        cb(clock)
        cb = frames.shift()
      }
    })
    expect(screen.getByText('1,000')).toBeInTheDocument()
  })

  it('renders a 0% fill-bar (not NaN%) when target is 0', () => {
    renderWithProviders(<StatNumber value={0} target={0} />)
    const bar = screen.getByTestId('stat-fillbar')
    expect(bar).toHaveStyle({ width: '0%' })
  })

  it('settles exactly on a non-integer value after animating (no float rounding drift)', () => {
    // Float interpolation of the final frame can land at 99.95500000000004
    // instead of 99.955; the final frame must snap to the exact target so the
    // settled display shows "99.955", not the rounded "99.96".
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb)
      return frames.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    let clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)

    vi.mocked(useReducedMotion).mockReturnValue(false)
    renderWithProviders(<StatNumber value={99.955} label="Uptime" />)

    clock = 360
    act(() => {
      let cb = frames.shift()
      while (cb) {
        cb(clock)
        cb = frames.shift()
      }
    })

    expect(screen.getByText('99.955')).toBeInTheDocument()
    expect(screen.queryByText('99.96')).not.toBeInTheDocument()
  })
})
