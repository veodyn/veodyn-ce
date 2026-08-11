// What the mock contribution seam owes a build that is missing a feature.
//
// The property under test is one sentence and it is the whole task: a
// collection nobody contributes reads as `[]`, never as `undefined`. Mock mode
// is what `pnpm test:e2e` runs on and what the docs screenshots are produced
// from, so the difference between those two is the difference between a screen
// that says "no KPIs yet" and a screen that throws.
//
// Every case builds its own registry rather than mocking the module, the
// pattern featureList, assembleSearchSources, Slot and the proposal seam all
// follow.
import { describe, expect, it, vi } from 'vitest'
import { ErrorIds } from '@/lib/errorIds'
import { hydrateMockData } from '@/stores/mock-data-hydration'
import { assembleMockData } from './mock-contributions'
import type { FeatureDescriptor, MockDataFactory } from './types'

function featureWith(id: string, mockData: MockDataFactory): FeatureDescriptor {
  return { id, nav: [], routes: [], mockData }
}

/** A store shaped like the real one: the collections exist, and start empty. */
function storeStub(initial: Record<string, unknown[]> = { kpis: [], reports: [], queries: [] }) {
  let state: Record<string, unknown> = { ...initial }
  return {
    getState: () => state,
    setState: (patch: Partial<Record<string, unknown>>) => {
      state = { ...state, ...patch }
    },
    read: () => state,
  }
}

describe('assembleMockData', () => {
  it('is an empty record with no contributors, and does not throw', async () => {
    await expect(assembleMockData({})).resolves.toEqual({})
  })

  it('merges what each feature seeds, keyed by collection', async () => {
    const registry = {
      kpis: featureWith('kpis', async () => ({ kpis: [{ id: 'otp' }] })),
      reports: featureWith('reports', async () => ({ reports: [{ id: 'q3' }], publications: [] })),
    }

    await expect(assembleMockData(registry)).resolves.toEqual({
      kpis: [{ id: 'otp' }],
      reports: [{ id: 'q3' }],
      publications: [],
    })
  })

  it('concatenates two features that seed the same collection, in featureList order', async () => {
    // Unlike a slot or a proposal kind, a collection is a list, so two features
    // both having rows for it is ordinary rather than a packaging mistake.
    const registry = {
      alerts: featureWith('alerts', async () => ({ feeds: ['from alerts'] })),
      kpis: featureWith('kpis', async () => ({ feeds: ['from kpis'] })),
    }

    await expect(assembleMockData(registry)).resolves.toEqual({
      feeds: ['from alerts', 'from kpis'],
    })
  })

  it('drops one feature s fixtures when its loader rejects, and keeps the rest', async () => {
    // A half-applied overlay. Mock mode has to keep running with that feature's
    // collections empty, not fail to start.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const registry = {
      kpis: featureWith('kpis', async () => {
        throw new Error('chunk 404')
      }),
      reports: featureWith('reports', async () => ({ reports: [{ id: 'q3' }] })),
    }

    await expect(assembleMockData(registry)).resolves.toEqual({ reports: [{ id: 'q3' }] })
    expect(logged.mock.calls.flat().join(' ')).toContain(ErrorIds.MOCK_DATA_UNAVAILABLE)
    logged.mockRestore()
  })
})

describe('hydrateMockData', () => {
  it('leaves a collection nobody contributes as the empty array it already was', async () => {
    // The bug class this seam can introduce, pinned. `kpis` must be [] and not
    // undefined: `state.kpis.length` is on the community Home page and on
    // /favorites, and one of those two values renders and the other throws.
    const store = storeStub()

    await hydrateMockData(store, {})

    expect(store.read().kpis).toEqual([])
    expect(store.read().reports).toEqual([])
    expect(store.read()).toHaveProperty('kpis')
  })

  it('fills the collections a feature contributes', async () => {
    const store = storeStub()

    await hydrateMockData(store, {
      kpis: featureWith('kpis', async () => ({ kpis: [{ id: 'otp' }] })),
    })

    expect(store.read().kpis).toEqual([{ id: 'otp' }])
    // Untouched, and still an array rather than gone.
    expect(store.read().reports).toEqual([])
  })

  it('ignores a contribution naming a collection the store does not declare', async () => {
    // Data with no reader. Letting it through would put a property on the state
    // object that no type knows about, which is how a typo becomes a fixture
    // nobody can find.
    const store = storeStub()

    await hydrateMockData(store, {
      kpis: featureWith('kpis', async () => ({ kpiz: [{ id: 'typo' }] })),
    })

    expect(store.read()).not.toHaveProperty('kpiz')
  })
})
