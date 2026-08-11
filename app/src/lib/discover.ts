import type { MockDashboard, MockQuery } from '@/lib/mock-data'

// A ranked Discover entry. Dashboards and queries are unified into one list so
// the page can show the org's most notable objects together.
export interface DiscoverItem {
  type: 'dashboard' | 'query'
  id: number
  name: string
  href: string
  isFavorite: boolean
  updatedAt: string
  score: number
}

// Favorites always rank above non-favorites (the bonus exceeds any epoch
// timestamp), then by recency within each group. Recency uses
// Date.parse(updated_at) so the score is deterministic and never depends on the
// current clock. View-count is a future signal once the object metadata carries
// it (umbrella spec section 5).

function toItem(
  type: 'dashboard' | 'query',
  o: { id: number; name: string; is_favorite?: boolean; updated_at: string }
): DiscoverItem {
  const isFavorite = o.is_favorite ?? false
  return {
    type,
    id: o.id,
    name: o.name,
    href: type === 'dashboard' ? `/dashboards/${o.id}` : `/queries/${o.id}`,
    isFavorite,
    updatedAt: o.updated_at,
    // The score is the recency epoch; favorites-first is enforced as a hard
    // sort tier below rather than folded into this number, so the ordering
    // holds for any valid Date.parse value (a finite favorite bonus could be
    // beaten by an extreme-past non-favorite epoch).
    score: Date.parse(o.updated_at) || 0,
  }
}

export function rankDiscover(
  dashboards: MockDashboard[],
  queries: MockQuery[],
  limit = 12
): DiscoverItem[] {
  const items = [
    ...dashboards.map((d) => toItem('dashboard', d)),
    ...queries.map((q) => toItem('query', q)),
  ]
  // Favorites always rank first (a hard tier), then by recency within each tier.
  items.sort((a, b) => (a.isFavorite === b.isFavorite ? b.score - a.score : a.isFavorite ? -1 : 1))
  return items.slice(0, limit)
}
