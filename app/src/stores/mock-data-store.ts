import { create } from 'zustand'
import {
  mockQueries, type MockQuery,
  mockDashboards, type MockDashboard,
  mockDataSources, type MockDataSource,
  mockAlerts, type MockAlert,
  mockUsers, type MockUser,
  mockGroups, type MockGroup,
  mockDestinations, type MockDestination,
  mockQuerySnippets, type MockQuerySnippet,
  mockQueryResults, type MockQueryResult,
  mockDatasets, mockDomainHubs,
  mockAnnotations,
} from '@/lib/mock-data'
import type { Dataset, DomainHub } from '@/types/catalog'
import type { Annotation } from '@/types/annotation'
import { hydrateMockData } from './mock-data-hydration'
import { createFeedSlice, type FeedSlice } from './feed-slice'
import { createPublishedFeedSlice, type PublishedFeedSlice } from './published-feed-slice'
import { createContributedSlices, type ContributedSlices } from './generated-mock-slices'

/**
 * What this store holds in every build, with no feature installed. The feed
 * cadence writes in ./feed-slice.ts are part of it: feeds are community, and that
 * file is a size split rather than a CE/EE one.
 *
 * Everything an installed feature adds is `ContributedSlices`, which is generated:
 * a descriptor names its slice module as a string (`mockSlices` in
 * src/features/types.ts) and the generator emits the static import, because a
 * slice carries ACTIONS and an action cannot arrive through a deferred loader in
 * time for a store built with `create()` at module scope. Rows still arrive
 * through `mockData` and `hydrateMockData` below. An intersection rather than an
 * interface with an extends clause, because a build with no feature has nothing to
 * name in one, so `state.kpis` does not compile without the KPI feature.
 */
interface MockDataCore {
  queries: MockQuery[]
  dashboards: MockDashboard[]
  dataSources: MockDataSource[]
  alerts: MockAlert[]
  users: MockUser[]
  groups: MockGroup[]
  destinations: MockDestination[]
  querySnippets: MockQuerySnippet[]
  queryResults: Record<number, MockQueryResult>
  // Redash-owned kinds are keyed by id, the sidecar-owned ones by slug. `sidecar`
  // is an open map rather than a property per kind, because which kinds a build
  // can star is a property of which features are installed. Its keys are the
  // singular kinds the wire uses; see src/features/favorite-kinds.ts.
  favorites: { queries: number[]; dashboards: number[]; sidecar: Record<string, string[]> }
  /**
   * Who has been granted access to each object, by id. Mock mirror of Redash's
   * /api/<type>/<id>/acl, so the permissions dialog has somewhere to write.
   */
  accessGrants: { queries: Record<number, number[]>; dashboards: Record<number, number[]> }
  // Data Catalog: read-only in the MVP, no CRUD actions below.
  datasets: Dataset[]
  domainHubs: DomainHub[]
  annotations: Annotation[]

  // Queries
  addQuery: (query: MockQuery) => void
  // No deleteQuery: Redash's DELETE archives, which is an is_archived update.
  updateQuery: (id: number, updates: Partial<MockQuery>) => void

  // Dashboards
  addDashboard: (dashboard: MockDashboard) => void
  updateDashboard: (id: number, updates: Partial<MockDashboard>) => void
  deleteDashboard: (id: number) => void

  // Data Sources
  addDataSource: (ds: MockDataSource) => void
  updateDataSource: (id: number, updates: Partial<MockDataSource>) => void
  deleteDataSource: (id: number) => void

  // Alerts
  addAlert: (alert: MockAlert) => void
  updateAlert: (id: number, updates: Partial<MockAlert>) => void
  deleteAlert: (id: number) => void

  // Users
  addUser: (user: MockUser) => void
  updateUser: (id: number, updates: Partial<MockUser>) => void

  // Groups
  addGroup: (group: MockGroup) => void
  deleteGroup: (id: number) => void

  // Destinations
  addDestination: (dest: MockDestination) => void
  updateDestination: (id: number, updates: Partial<MockDestination>) => void
  deleteDestination: (id: number) => void

  // Query Snippets
  addQuerySnippet: (snippet: MockQuerySnippet) => void
  updateQuerySnippet: (id: number, updates: Partial<MockQuerySnippet>) => void
  deleteQuerySnippet: (id: number) => void

  // Annotations
  addAnnotation: (annotation: Annotation) => void
  deleteAnnotation: (id: number) => void

  // Favorites
  toggleFavorite: (type: 'queries' | 'dashboards', id: number) => void
  // Separate from toggleFavorite rather than a widened signature: these ids are
  // slugs, and the objects carry no is_favorite field to keep in step.
  toggleVeodynFavorite: (kind: string, id: string) => void
  grantAccess: (type: 'queries' | 'dashboards', id: number, userId: number) => void
  revokeAccess: (type: 'queries' | 'dashboards', id: number, userId: number) => void

  // Next ID helper
  nextId: (collection: 'queries' | 'dashboards' | 'dataSources' | 'alerts' | 'users' | 'groups' | 'destinations' | 'querySnippets' | 'annotations') => number
}

export type MockDataState = MockDataCore & FeedSlice & PublishedFeedSlice & ContributedSlices

export const useMockDataStore = create<MockDataState>((set, get, store) => ({
  // ORDER IS BEHAVIOUR: a key two slices both declare resolves to whichever is
  // spread last. Contributed first, then community.
  ...createContributedSlices(set, get, store),
  ...createFeedSlice(set, get, store),
  ...createPublishedFeedSlice(set, get, store),
  queries: [...mockQueries],
  dashboards: [...mockDashboards],
  dataSources: [...mockDataSources],
  alerts: [...mockAlerts],
  users: [...mockUsers],
  groups: [...mockGroups],
  destinations: [...mockDestinations],
  querySnippets: [...mockQuerySnippets],
  queryResults: { ...mockQueryResults },
  datasets: [...mockDatasets],
  domainHubs: [...mockDomainHubs],
  annotations: [...mockAnnotations],
  favorites: {
    queries: mockQueries.filter((q) => q.is_favorite).map((q) => q.id),
    dashboards: mockDashboards.filter((d) => d.is_favorite).map((d) => d.id),
    // Nothing starred to begin with, and empty rather than a key per installed
    // kind: every reader defaults a missing kind to no stars.
    sidecar: {},
  },
  // Nothing is granted to begin with: an object starts owned by its author and
  // shared with nobody.
  accessGrants: { queries: {}, dashboards: {} },

  addQuery: (query) => set((s) => ({ queries: [...s.queries, query] })),
  updateQuery: (id, updates) =>
    set((s) => ({
      queries: s.queries.map((q) => (q.id === id ? { ...q, ...updates } : q)),
    })),
  addDashboard: (dashboard) =>
    set((s) => ({ dashboards: [...s.dashboards, dashboard] })),
  updateDashboard: (id, updates) =>
    set((s) => ({
      dashboards: s.dashboards.map((d) =>
        d.id === id ? { ...d, ...updates } : d
      ),
    })),
  deleteDashboard: (id) =>
    set((s) => ({ dashboards: s.dashboards.filter((d) => d.id !== id) })),

  addDataSource: (ds) =>
    set((s) => ({ dataSources: [...s.dataSources, ds] })),
  updateDataSource: (id, updates) =>
    set((s) => ({
      dataSources: s.dataSources.map((ds) =>
        ds.id === id ? { ...ds, ...updates } : ds
      ),
    })),
  deleteDataSource: (id) =>
    set((s) => ({ dataSources: s.dataSources.filter((ds) => ds.id !== id) })),

  addAlert: (alert) => set((s) => ({ alerts: [...s.alerts, alert] })),
  updateAlert: (id, updates) =>
    set((s) => ({
      alerts: s.alerts.map((a) => (a.id === id ? { ...a, ...updates } : a)),
    })),
  deleteAlert: (id) =>
    set((s) => ({ alerts: s.alerts.filter((a) => a.id !== id) })),

  addUser: (user) => set((s) => ({ users: [...s.users, user] })),
  updateUser: (id, updates) =>
    set((s) => ({
      users: s.users.map((u) => (u.id === id ? { ...u, ...updates } : u)),
    })),

  addGroup: (group) => set((s) => ({ groups: [...s.groups, group] })),
  deleteGroup: (id) =>
    set((s) => ({ groups: s.groups.filter((g) => g.id !== id) })),

  addDestination: (dest) =>
    set((s) => ({ destinations: [...s.destinations, dest] })),
  updateDestination: (id, updates) =>
    set((s) => ({
      destinations: s.destinations.map((d) =>
        d.id === id ? { ...d, ...updates } : d
      ),
    })),
  deleteDestination: (id) =>
    set((s) => ({ destinations: s.destinations.filter((d) => d.id !== id) })),

  addQuerySnippet: (snippet) =>
    set((s) => ({ querySnippets: [...s.querySnippets, snippet] })),
  updateQuerySnippet: (id, updates) =>
    set((s) => ({
      querySnippets: s.querySnippets.map((qs) =>
        qs.id === id ? { ...qs, ...updates } : qs
      ),
    })),
  deleteQuerySnippet: (id) =>
    set((s) => ({
      querySnippets: s.querySnippets.filter((qs) => qs.id !== id),
    })),

  addAnnotation: (annotation) =>
    set((s) => ({ annotations: [...s.annotations, annotation] })),
  deleteAnnotation: (id) =>
    set((s) => ({ annotations: s.annotations.filter((a) => a.id !== id) })),

  toggleFavorite: (type, id) =>
    set((s) => {
      const current = s.favorites[type]
      const next = current.includes(id)
        ? current.filter((fid) => fid !== id)
        : [...current, id]

      if (type === 'queries') {
        return {
          favorites: { ...s.favorites, [type]: next },
          queries: s.queries.map((q) =>
            q.id === id ? { ...q, is_favorite: next.includes(id) } : q
          ),
        }
      }
      return {
        favorites: { ...s.favorites, [type]: next },
        dashboards: s.dashboards.map((d) =>
          d.id === id ? { ...d, is_favorite: next.includes(id) } : d
        ),
      }
    }),

  toggleVeodynFavorite: (kind, id) =>
    set((s) => {
      // Defaulted, because the map starts empty: the first star of a kind
      // creates its list rather than finding one waiting.
      const current = s.favorites.sidecar[kind] ?? []
      const next = current.includes(id) ? current.filter((fid) => fid !== id) : [...current, id]
      return { favorites: { ...s.favorites, sidecar: { ...s.favorites.sidecar, [kind]: next } } }
    }),

  grantAccess: (type, id, userId) =>
    set((s) => {
      const current = s.accessGrants[type][id] ?? []
      if (current.includes(userId)) return {}
      return {
        accessGrants: {
          ...s.accessGrants,
          [type]: { ...s.accessGrants[type], [id]: [...current, userId] },
        },
      }
    }),

  revokeAccess: (type, id, userId) =>
    set((s) => ({
      accessGrants: {
        ...s.accessGrants,
        [type]: {
          ...s.accessGrants[type],
          [id]: (s.accessGrants[type][id] ?? []).filter((uid) => uid !== userId),
        },
      },
    })),

  nextId: (collection) => {
    const items = get()[collection] as { id: number }[]
    return items.length > 0 ? Math.max(...items.map((i) => i.id)) + 1 : 1
  },
}))

// Resolves once the installed features' fixtures are in. Every collection above
// already reads as an array before it does; see mock-data-hydration.ts.
export const mockDataReady = hydrateMockData(useMockDataStore)
