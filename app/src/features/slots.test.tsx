// What a slot owes the community edition. Three properties, and the third is
// the one this seam exists for.
//
// This file covers `<Slot>`, the single-contributor mechanism. Its sibling
// `<SlotList>` is covered in slots-multi.test.tsx, and the fixtures both use
// are in slots.test-helpers.ts.
//
// Every case builds its own registry object rather than mocking the module.
// That is the pattern the rest of src/features uses (featureList, featureNavRows
// and assembleSearchSources all take the registry as an optional final
// parameter), and here it is also what keeps the lazy-component cache honest:
// the cache is keyed on registry identity, so one case cannot answer for the
// next.
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { Slot, hasSlotContributor } from './slots'
import { COUNTER, DASHBOARD, DATASET, featureWith } from './slots.test-helpers'
import type { SingleSlotId, SlotProps } from './types'
import type { HubCounter } from '@/types/catalog'

describe('Slot', () => {
  it('renders the fallback, and enters no loader at all, when nothing contributes', () => {
    // The loader belongs to a DIFFERENT slot in the same registry. Asserting it
    // was never called is what pins "issues no request": a resolver that walked
    // every descriptor's loaders looking for a match would trip this even
    // though the rendered output was right.
    const otherSlot = vi.fn(async () => ({ default: () => <span>other slot</span> }))
    const registry = { alerts: featureWith('alerts', { 'catalog.hubCounters': otherSlot }) }

    render(
      <Slot
        id="home.notableChanges"
        props={{}}
        fallback={<span>community strip</span>}
        registry={registry}
      />
    )

    expect(screen.getByText('community strip')).toBeInTheDocument()
    expect(otherSlot).not.toHaveBeenCalled()
    expect(hasSlotContributor('home.notableChanges', registry)).toBe(false)
  })

  it('renders the contributed component, with the slot props, when a feature fills it', async () => {
    const registry = {
      kpis: featureWith('kpis', {
        'catalog.hubCounters': async () => ({
          default: ({ counter }: { counter: HubCounter }) => (
            <span>enterprise tile for {counter.label}</span>
          ),
        }),
      }),
    }

    render(
      <Slot
        id="catalog.hubCounters"
        props={{ counter: COUNTER }}
        fallback={<span>static counter</span>}
        registry={registry}
      />
    )

    expect(
      await screen.findByText('enterprise tile for On-time performance')
    ).toBeInTheDocument()
    expect(screen.queryByText('static counter')).not.toBeInTheDocument()
    expect(hasSlotContributor('catalog.hubCounters', registry)).toBe(true)
  })

  // The state a community build is in when it is pointed at an enterprise API,
  // or when an overlay is half applied: the registry names a component whose
  // chunk is not there. React.lazy rethrows a rejected loader during render, so
  // without the catch in slots.tsx this is a blank surface or somebody's error
  // boundary, and Home goes down over a feature the build was never supposed to
  // have. The fallback is asserted AFTER the failure is logged, not before,
  // because before the rejection settles the fallback is on screen either way.
  it('renders the fallback, and does not throw, when the contributed loader rejects', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const registry = {
      kpis: featureWith('kpis', {
        'home.notableChanges': () => Promise.reject(new Error('no chunk')),
      }),
    }

    render(
      <Slot
        id="home.notableChanges"
        props={{}}
        fallback={<span>community strip</span>}
        registry={registry}
      />
    )

    await waitFor(() => {
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('E_SLOT_001'))
    })
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('home.notableChanges'))
    expect(screen.getByText('community strip')).toBeInTheDocument()

    logged.mockRestore()
  })

  it('takes the first contributor in registry order when two features fill one slot', async () => {
    // A packaging mistake, not a reason to refuse to render Home. Sorted by
    // registry key, so which one wins is a property of the build and not of
    // however the object literal happened to be typed.
    const registry = {
      zebra: featureWith('zebra', {
        'home.notableChanges': async () => ({ default: () => <span>from zebra</span> }),
      }),
      alpha: featureWith('alpha', {
        'home.notableChanges': async () => ({ default: () => <span>from alpha</span> }),
      }),
    }

    render(<Slot id="home.notableChanges" props={{}} fallback={null} registry={registry} />)

    expect(await screen.findByText('from alpha')).toBeInTheDocument()
  })

  it('enters a contributor loader once, however many times the surface renders', async () => {
    const load = vi.fn(async () => ({ default: () => <span>loaded once</span> }))
    const registry = { kpis: featureWith('kpis', { 'home.notableChanges': load }) }
    const element = (
      <Slot id="home.notableChanges" props={{}} fallback={null} registry={registry} />
    )

    const { rerender } = render(element)
    expect(await screen.findByText('loaded once')).toBeInTheDocument()
    rerender(element)
    render(element)

    expect(await screen.findAllByText('loaded once')).toHaveLength(2)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('reports no contributor for a slot no installed feature fills', () => {
    expect(hasSlotContributor('home.notableChanges', {})).toBe(false)
  })
})

// Mock mode and pnpm test:e2e both run with the registry populated, so the
// community shape of a slot is a state no other suite reaches. This table is
// mapped over SingleSlotId, so a slot added to that union without an entry here
// fails to compile: the empty case cannot be forgotten for a new slot, only
// written down. slots-multi.test.tsx does the same for MultiSlotId.
const SINGLE_EMPTY: { [Id in SingleSlotId]: SlotProps[Id] } = {
  'home.notableChanges': {},
  'home.aiDigest': {},
  'catalog.hubCounters': { counter: COUNTER },
  'dashboard.annotationSuggest': { dashboardId: 17, widgetId: 4 },
  'dashboard.viewActions': { dashboard: DASHBOARD },
  'captures.metrics': { datasets: [] },
  'publishedFeed.tokenPanel': { slug: 'vehicles-live' },
  'publishedFeed.blockedAttribution': { slug: 'vehicles-live', attemptId: 1 },
  'publishedFeed.schedule': { slug: 'vehicles-live' },
  'dataset.records': { dataset: DATASET },
  'dataset.headerActions': { dataset: DATASET },
}

describe('a single slot with no contributor', () => {
  it.each(Object.keys(SINGLE_EMPTY) as SingleSlotId[])(
    '%s renders its fallback and nothing else, and throws nothing',
    (id) => {
      // The cast is the same seam shellFor has: `id` is the union here, so the
      // compiler cannot pair it back up with its own props entry. The mapped
      // type above is what guarantees the pairing.
      const props = SINGLE_EMPTY[id] as SlotProps[SingleSlotId]

      const { container } = render(<Slot id={id} props={props} fallback={null} registry={{}} />)

      expect(container).toBeEmptyDOMElement()
      expect(hasSlotContributor(id, {})).toBe(false)
    }
  )
})
