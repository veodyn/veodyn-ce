// One spelling per favoritable object kind, and the registry decides it.
//
// The defect this pins is a spelling collapse that used to be done by hand at
// every crossing: veodyn-api stores a star under the SINGULAR kind (`kpi`), the
// app wrote it under the PLURAL route name (`kpis`), and a lookup table in
// src/hooks/use-favorites.ts translated between them. A third kind could
// therefore arrive spelled either way, and the file that would have to learn
// about it was community.
//
// Everything below derives from the descriptors rather than naming a kind.
// Deliberately NOT by importing the vocabulary from the module under test: a
// test that asks production what the kinds are and then checks production
// against that answer agrees with itself no matter which spelling production
// picked. `featureList()` and the two descriptor fields are the independent
// source, and they are what a new feature package fills in.
//
// In a build with no feature installed there are no contributed kinds and every
// assertion here is vacuous. That is the honest reading, not a hole: the
// community edition ships no kind for the sidecar to store a star on, and the
// queries and dashboards it does ship are Redash's, with their favorites on a
// different backend entirely.
import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import { featureList } from '@/features'
import { useToggleFavorite, useVeodynFavorites } from '@/hooks/use-favorites'
import { useMockDataStore } from '@/stores/mock-data-store'
import { resetStores } from '@/test/utils'

afterEach(resetStores)

/**
 * The installed features whose objects can be starred.
 *
 * Filling `favorites.section` is the signal, and it is the same one the
 * Favorites page's empty state already derives its links from
 * (`STARRABLE` in src/app/favorites/page.tsx): a feature that contributes a
 * section is exactly a feature whose objects can appear on that page.
 */
const contributors = featureList().filter(
  (feature) => feature.slots?.['favorites.section'] !== undefined
)

/** The kind each of them names itself by, which is the one spelling. */
const kinds = contributors
  .map((feature) => feature.searchType?.type)
  .filter((kind): kind is string => kind !== undefined)

function harness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return renderHook(() => ({ toggle: useToggleFavorite(), favorites: useVeodynFavorites() }), {
    wrapper: Wrapper,
  })
}

describe('the favoritable kinds this build has', () => {
  it('gives every contributing feature a kind to be addressed by', () => {
    // A feature can fill the favorites section without declaring a searchType,
    // and the type system allows it because searchType is optional. It is a
    // packaging mistake all the same: the star writes to /favorites/<kind>/<id>
    // and there would be no kind to put in the path, so the section would list
    // objects nobody could unstar. Named here rather than left to fail as a
    // silently dropped kind somewhere downstream.
    const nameless = contributors.filter((feature) => feature.searchType === undefined)
    expect(nameless.map((feature) => feature.id)).toEqual([])
  })

  it('spells each kind once across the installed features', () => {
    expect([...new Set(kinds)]).toEqual(kinds)
  })
})

describe('a star written under the kind the descriptor names', () => {
  it('comes back under that same kind, with no translation in between', async () => {
    for (const kind of kinds) {
      const { result } = harness()
      await waitFor(() => expect(result.current.favorites.data).toBeDefined())

      const id = `round-trip-${kind}`
      // Through the mutation the star control uses, not through the store
      // directly: the crossing being pinned is the one between what a caller
      // asks to star and what the read answers with, and the hook is where the
      // hand-written translation lived.
      await act(async () => {
        await result.current.toggle.mutateAsync({ type: kind, id, favorite: true })
      })

      await waitFor(() => {
        expect(result.current.favorites.data?.[kind]).toContain(id)
      })
      // And the store holds it under the same word, so a build reading the
      // fixtures directly sees what the hook saw.
      expect(useMockDataStore.getState().favorites.sidecar[kind]).toContain(id)
    }
  })
})
