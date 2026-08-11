// The community counter row: the grid, and the counters this build renders on
// its own. A counter naming a kpiId goes through the catalog.hubCounters slot,
// and what the KPI feature puts in it is covered in
// components/kpi/hub-counter-tile.test.tsx, which is also where the composed
// behaviour (a real registry, a real loader) is asserted.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders, resetStores } from '@/test/utils'
import { HubCounterRow } from './hub-counter-row'
import type { HubCounter } from '@/types/catalog'

vi.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }))

afterEach(() => {
  resetStores()
})

describe('HubCounterRow', () => {
  it('renders each counter label in the mono tracked style and its value with tabular-nums', () => {
    const counters: HubCounter[] = [{ label: 'Active Feeds', value: 42 }]
    renderWithProviders(<HubCounterRow counters={counters} />)

    const label = screen.getByText('Active Feeds')
    expect(label).toHaveClass('font-mono', 'uppercase', 'tracking-wider')

    const value = screen.getByText('42')
    expect(value).toHaveClass('font-mono', 'tabular-nums')
    expect(value.className).not.toMatch(/font-display/)
  })

  it('renders a positive delta as a "+N%" chip with an up affordance', () => {
    const counters: HubCounter[] = [
      { label: 'Uptime', value: 99, unit: '%', delta: 3.2 },
    ]
    renderWithProviders(<HubCounterRow counters={counters} />)

    const chip = screen.getByText(/\+3\.2%/)
    expect(chip).toBeInTheDocument()
    expect(chip.closest('span')?.querySelector('svg')).toHaveClass('lucide-arrow-up')
  })

  it('renders a negative delta with a down affordance, not color alone', () => {
    const counters: HubCounter[] = [
      { label: 'Error Rate', value: 2, unit: '%', delta: -1.5 },
    ]
    renderWithProviders(<HubCounterRow counters={counters} />)

    const chip = screen.getByText(/-1\.5%/)
    expect(chip).toBeInTheDocument()
    expect(chip.closest('span')?.querySelector('svg')).toHaveClass('lucide-arrow-down')
  })

  it('appends the unit after the value for non-percent units', () => {
    const counters: HubCounter[] = [{ label: 'Latency', value: 142, unit: 'ms' }]
    renderWithProviders(<HubCounterRow counters={counters} />)
    expect(screen.getByText(/142\s*ms/)).toBeInTheDocument()
  })

  // Asserted synchronously, before any slot could have loaded, which is the
  // fallback path and also exactly what a community build renders forever: a
  // counter that names a KPI still shows the number written on it. A blank tile
  // here is the whole failure this fallback exists to prevent.
  it('shows the static counter for a kpi-backed counter until, or without, a feature tile', () => {
    const counters: HubCounter[] = [
      { label: 'On-time performance', value: 82, unit: '%', kpiId: 'on-time-performance' },
    ]
    renderWithProviders(<HubCounterRow counters={counters} />)

    expect(screen.getByText('On-time performance')).toHaveClass('font-mono', 'uppercase')
    expect(screen.getByText(/82\s*%/)).toBeInTheDocument()
  })
})
