import { afterEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders, resetStores } from '@/test/utils'
import { DeltaChip, DELTA_CHIP_TESTID } from './delta-chip'

afterEach(() => resetStores())

describe('DeltaChip', () => {
  it('renders a positive delta as a "+N%" chip with an up affordance and the fresh color', () => {
    renderWithProviders(<DeltaChip delta={3.2} unit="%" />)

    const chip = screen.getByText(/\+3\.2%/)
    expect(chip).toBeInTheDocument()
    expect(chip).toHaveClass('text-status-fresh')
    expect(chip.querySelector('svg')).toHaveClass('lucide-arrow-up')
  })

  it('renders a negative delta with a down affordance and the stale color, not color alone', () => {
    renderWithProviders(<DeltaChip delta={-1.5} unit="%" />)

    const chip = screen.getByText(/-1\.5%/)
    expect(chip).toBeInTheDocument()
    expect(chip).toHaveClass('text-status-stale')
    expect(chip.querySelector('svg')).toHaveClass('lucide-arrow-down')
  })

  it('spaces a non-percent unit rather than dropping it', () => {
    // A bare "+5" beside a value of 342,910 reads as five more of the thing.
    // The unit is the only thing that says what moved.
    renderWithProviders(<DeltaChip delta={5} unit="ms" />)
    expect(screen.getByText(/\+5 ms/)).toBeInTheDocument()
  })

  it('treats no change as neither a rise nor good news', () => {
    renderWithProviders(<DeltaChip delta={0} unit="%" />)

    const chip = screen.getByText(/No change/)
    expect(chip).toHaveClass('text-muted-foreground')
    expect(chip.querySelector('svg')).not.toHaveClass('lucide-arrow-up')
  })

  it.each([
    ['a rise', 3.2],
    ['no change', 0],
    ['a fall', -1.5],
  ])('carries the delta test id when it reports %s', (_label, delta) => {
    // e2e asks "is a delta being reported at all?" separately from "what does
    // it say?". Dropping this hook from either branch would make that question
    // unanswerable, and an absence assertion would start passing vacuously.
    renderWithProviders(<DeltaChip delta={delta} unit="%" />)
    expect(screen.getByTestId(DELTA_CHIP_TESTID)).toBeInTheDocument()
  })

  it('paints a rise as bad news when lower is better', () => {
    // Downtime hours climbing is not a win, however green the token is.
    renderWithProviders(<DeltaChip delta={1.5} unit="h" direction="lower-is-better" />)

    const chip = screen.getByText(/\+1\.5 h/)
    expect(chip).toHaveClass('text-status-stale')
    // The arrow still reports which way the number moved, only the colour flips.
    expect(chip.querySelector('svg')).toHaveClass('lucide-arrow-up')
  })

  it('rounds a long float instead of printing every digit it was given', () => {
    // Measured on stage 2026-07-29: /kpis/average-rail-speed-by-line rendered
    // "-0.0035567007803818 mph" beside a value of "1.582 mph".
    renderWithProviders(<DeltaChip delta={-0.0035567007803818} unit="mph" />)

    expect(screen.getByText(/-0\.0036 mph/)).toBeInTheDocument()
    expect(screen.queryByText(/0035567/)).not.toBeInTheDocument()
  })

  it('never rounds a real movement down to zero', () => {
    // The guard that makes the case above safe. Rounding to a fixed 2dp would
    // print "-0" here, which says no change while the arrow says a fall, and
    // contradicts the dedicated "No change" branch that owns delta === 0.
    renderWithProviders(<DeltaChip delta={-0.0000191} unit="mph" />)

    const chip = screen.getByTestId(DELTA_CHIP_TESTID)
    expect(chip).toHaveTextContent(/-0\.000019 mph/)
    expect(chip).not.toHaveTextContent(/^-0 mph/)
    expect(chip).not.toHaveTextContent(/No change/)
    expect(chip.querySelector('svg')).toHaveClass('lucide-arrow-down')
  })

  it('keeps a large delta exact rather than trading digits for brevity', () => {
    // Significant-digit formatting is the small-number escape hatch only; a
    // hub counter's delta is an absolute count and 342,910 must not become
    // "343,000". It also gains the separator the raw number never had.
    renderWithProviders(<DeltaChip delta={342910} unit="boardings" />)
    expect(screen.getByText(/\+342,910 boardings/)).toBeInTheDocument()
  })

  it('paints a fall as good news when lower is better', () => {
    renderWithProviders(<DeltaChip delta={-1.5} unit="h" direction="lower-is-better" />)

    const chip = screen.getByText(/-1\.5 h/)
    expect(chip).toHaveClass('text-status-fresh')
    expect(chip.querySelector('svg')).toHaveClass('lucide-arrow-down')
  })
})
