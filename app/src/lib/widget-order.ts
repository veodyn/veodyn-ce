import type { MockDashboardWidget } from '@/lib/mock-data'

// The order a reader sees a dashboard's widgets in: top row first, left to
// right within a row.
//
// dashboard-grid places widgets from `options.position` (row/col), but anything
// that replays a dashboard as a *sequence* was iterating `dashboard.widgets`
// directly, which is whatever order the API returned, effectively creation
// order. The two agree only by accident. On the reference dashboard the deck
// opened on the second widget and then ran 2, 4, 3.
//
// Sorting here rather than in each caller because there are two of them and
// they fail differently: a presenter notices a shuffled deck and works around
// it live, while a wall screen in a lobby cycles in the wrong order
// indefinitely with nobody positioned to report it.
export function widgetsInReadingOrder(widgets: MockDashboardWidget[]): MockDashboardWidget[] {
  // Copied before sorting: the array comes from React Query's cache, and
  // sorting in place would mutate cached data every render.
  return [...widgets].sort(
    (a, b) =>
      a.options.position.row - b.options.position.row ||
      a.options.position.col - b.options.position.col
  )
}
