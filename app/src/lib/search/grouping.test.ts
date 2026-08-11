import { describe, expect, it } from 'vitest'
import { Boxes } from 'lucide-react'
import { capGroup, countByType, groupResults, GROUP_CAP } from './grouping'
import type { FeatureSearchType } from '@/features'
import type { SearchResultItem, SearchSourceType } from '@/services/search/types'

function item(type: SearchSourceType, n: number): SearchResultItem {
  return { id: `${type}-${n}`, type, title: `${type} ${n}`, href: `/${type}/${n}` }
}

/**
 * A stand-in for whatever a feature package contributes, passed explicitly to
 * countByType and groupResults through the parameter both take for it.
 *
 * The cases below are about the mechanism (core types first, then contributed
 * ones, in a stable order that the result order cannot disturb), so they are
 * driven by this rather than by whichever features happen to be installed.
 * That makes them true of every build, which the installed-registry versions
 * they replaced were not.
 */
const WIDGET: FeatureSearchType = {
  type: 'widget',
  label: 'Widgets',
  noun: 'widgets',
  icon: Boxes,
}

describe('countByType', () => {
  it('reports zero for types with no results', () => {
    expect(countByType([], [WIDGET])).toEqual({ query: 0, dashboard: 0, catalog: 0, widget: 0 })
  })

  it('counts each type independently', () => {
    const counts = countByType([item('query', 1), item('query', 2), item('widget', 1)], [WIDGET])
    expect(counts.query).toBe(2)
    expect(counts.widget).toBe(1)
    expect(counts.dashboard).toBe(0)
  })

  it('with an empty registry, counts only the three core types', () => {
    expect(countByType([], [])).toEqual({ query: 0, dashboard: 0, catalog: 0 })
  })
})

describe('capGroup', () => {
  it('truncates at the cap and reports the untruncated total', () => {
    const items = Array.from({ length: 7 }, (_, i) => item('query', i))
    const group = capGroup('query', items)
    expect(group.items).toHaveLength(GROUP_CAP)
    expect(group.total).toBe(7)
    expect(group.truncated).toBe(true)
  })

  it('does not mark a group truncated when it fits exactly at the cap', () => {
    const items = Array.from({ length: GROUP_CAP }, (_, i) => item('query', i))
    const group = capGroup('query', items)
    expect(group.items).toHaveLength(GROUP_CAP)
    expect(group.truncated).toBe(false)
  })
})

describe('groupResults', () => {
  // The contributed type arrives first in the result set and still sorts last,
  // behind all three core types, which is the whole point of iterating the
  // canonical order instead of insertion order.
  it('orders groups by canonical type order regardless of result order', () => {
    const groups = groupResults(
      [item('widget', 1), item('query', 1), item('dashboard', 1)],
      GROUP_CAP,
      [WIDGET]
    )
    expect(groups.map((g) => g.type)).toEqual(['query', 'dashboard', 'widget'])
  })

  it('omits types with no results', () => {
    const groups = groupResults([item('widget', 1)], GROUP_CAP, [WIDGET])
    expect(groups.map((g) => g.type)).toEqual(['widget'])
  })

  it('caps each group independently', () => {
    const results = [
      ...Array.from({ length: 8 }, (_, i) => item('query', i)),
      ...Array.from({ length: 2 }, (_, i) => item('widget', i)),
    ]
    const groups = groupResults(results, GROUP_CAP, [WIDGET])
    expect(groups[0]).toMatchObject({ type: 'query', total: 8, truncated: true })
    expect(groups[0].items).toHaveLength(GROUP_CAP)
    expect(groups[1]).toMatchObject({ type: 'widget', total: 2, truncated: false })
  })

  it('returns an empty array for no results', () => {
    expect(groupResults([])).toEqual([])
  })

  it('with an empty registry, orders only the three core types', () => {
    const groups = groupResults([item('catalog', 1), item('query', 1)], GROUP_CAP, [])
    expect(groups.map((g) => g.type)).toEqual(['query', 'catalog'])
  })

  it('with an empty registry, drops a result of a type the registry no longer contributes', () => {
    const groups = groupResults([item('kpi', 1), item('query', 1)], GROUP_CAP, [])
    expect(groups.map((g) => g.type)).toEqual(['query'])
  })
})
