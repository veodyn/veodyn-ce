// `<SlotList>`, the multi-contributor half of the slot seam.
//
// The property under test is the one `<Slot>` deliberately does NOT have.
// Favorites and the profile page list one section per object kind, and the
// community surface cannot enumerate the kinds this build has, so every
// contributor renders rather than the first. Everything else (the registry-keyed
// lazy cache, the rejection-to-nothing behaviour, the E_SLOT_001 log line) is
// shared with `<Slot>` and is asserted here on the list path, because sharing
// the code is not the same as sharing the behaviour.
//
// Fixtures are in slots.test-helpers.ts; the single-contributor cases are in
// slots.test.tsx.
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { SlotList, hasSlotContributor } from './slots'
import { featureWith } from './slots.test-helpers'
import type { MultiSlotId, SlotProps } from './types'

describe('SlotList', () => {
  it('renders every contributor, in featureList order, not just the first', async () => {
    const registry = {
      reports: featureWith('reports', {
        'favorites.section': async () => ({ default: () => <li>starred reports</li> }),
      }),
      kpis: featureWith('kpis', {
        'favorites.section': async () => ({ default: () => <li>starred KPIs</li> }),
      }),
    }

    const { container } = render(
      <SlotList id="favorites.section" props={{}} registry={registry} />
    )

    expect(await screen.findByText('starred KPIs')).toBeInTheDocument()
    expect(screen.getByText('starred reports')).toBeInTheDocument()
    // Sorted by registry key, so kpis precedes reports whatever order the
    // object literal was typed in.
    expect([...container.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'starred KPIs',
      'starred reports',
    ])
  })

  it('passes the slot props to every contributor', async () => {
    const registry = {
      kpis: featureWith('kpis', {
        'profile.section': async () => ({
          default: ({ userId }: { userId: number }) => <span>KPIs owned by {userId}</span>,
        }),
      }),
    }

    render(<SlotList id="profile.section" props={{ userId: 7 }} registry={registry} />)

    expect(await screen.findByText('KPIs owned by 7')).toBeInTheDocument()
  })

  // One missing chunk costs one section. The same degradation
  // assembleSearchSources gives a search source that will not load, and the
  // reason a shared fallback would have been wrong here: there is no community
  // stand-in for "the KPI section", so its absence IS the community view, and
  // the report section beside it still has to render.
  it('drops only the contributor whose loader rejects, and logs it', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const registry = {
      kpis: featureWith('kpis', {
        'favorites.section': () => Promise.reject(new Error('no chunk')),
      }),
      reports: featureWith('reports', {
        'favorites.section': async () => ({ default: () => <span>starred reports</span> }),
      }),
    }

    render(<SlotList id="favorites.section" props={{}} registry={registry} />)

    expect(await screen.findByText('starred reports')).toBeInTheDocument()
    await waitFor(() => {
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('E_SLOT_001'))
    })
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('favorites.section'))
    expect(screen.queryByText('no chunk')).not.toBeInTheDocument()

    logged.mockRestore()
  })

  it('enters each contributor loader once, however many times the surface renders', async () => {
    const kpiLoad = vi.fn(async () => ({ default: () => <span>KPI section</span> }))
    const reportLoad = vi.fn(async () => ({ default: () => <span>report section</span> }))
    const registry = {
      kpis: featureWith('kpis', { 'favorites.section': kpiLoad }),
      reports: featureWith('reports', { 'favorites.section': reportLoad }),
    }
    const element = <SlotList id="favorites.section" props={{}} registry={registry} />

    const { rerender } = render(element)
    expect(await screen.findByText('KPI section')).toBeInTheDocument()
    rerender(element)

    expect(kpiLoad).toHaveBeenCalledTimes(1)
    expect(reportLoad).toHaveBeenCalledTimes(1)
  })
})

// Mapped over MultiSlotId for the reason SINGLE_EMPTY is mapped over
// SingleSlotId in slots.test.tsx: a slot added to the union without an entry
// here fails to compile.
const MULTI_EMPTY: { [Id in MultiSlotId]: SlotProps[Id] } = {
  'favorites.section': {},
  'profile.section': { userId: 2 },
}

describe('a multi slot with no contributor', () => {
  it.each(Object.keys(MULTI_EMPTY) as MultiSlotId[])(
    '%s renders nothing at all, and throws nothing',
    (id) => {
      const props = MULTI_EMPTY[id] as SlotProps[MultiSlotId]

      const { container } = render(<SlotList id={id} props={props} registry={{}} />)

      expect(container).toBeEmptyDOMElement()
      expect(hasSlotContributor(id, {})).toBe(false)
    }
  )
})
