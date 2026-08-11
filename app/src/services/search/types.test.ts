import { describe, expect, it } from 'vitest'
import { Boxes } from 'lucide-react'
import type { FeatureSearchType } from '@/features'
import {
  CORE_SEARCH_SOURCE_TYPES,
  CORE_SEARCH_TYPE_LABELS,
  searchTypeLabel,
  searchTypeNoun,
} from '@/services/search/types'

/**
 * A stand-in for whatever a feature package contributes, handed to both lookups
 * through the parameter they take for it. Same fixture and same reason as
 * grouping.test.ts's WIDGET.
 */
const WIDGET: FeatureSearchType = {
  type: 'widget',
  label: 'Widgets',
  noun: 'widgets',
  icon: Boxes,
}

describe('search types', () => {
  it('enumerates the three core CE source types in IA order', () => {
    expect(CORE_SEARCH_SOURCE_TYPES).toEqual(['query', 'dashboard', 'catalog'])
  })

  it('labels every core source type for grouped display', () => {
    expect(Object.keys(CORE_SEARCH_TYPE_LABELS).sort()).toEqual(
      [...CORE_SEARCH_SOURCE_TYPES].sort()
    )
    expect(CORE_SEARCH_TYPE_LABELS.query).toBe('Queries')
    expect(CORE_SEARCH_TYPE_LABELS.dashboard).toBe('Dashboards')
    expect(CORE_SEARCH_TYPE_LABELS.catalog).toBe('Datasets')
  })

  // Both lookups compose the closed core maps with the registry, and which
  // types the registry answers for is a fact about the build. So the
  // contributed half is driven by a stated list rather than by the installed
  // one: a type the list holds resolves to the words its descriptor carries,
  // and the same type resolves to nothing once the list is empty. That is the
  // whole composition, and both halves of it hold in every build.
  // types.enterprise.test.ts asserts what the real KPI and report descriptors
  // answer, which only a build that installs them can.
  it('resolves a contributed type from the registry it is given, and nothing from an empty one', () => {
    expect(searchTypeLabel('widget', [WIDGET])).toBe('Widgets')
    expect(searchTypeNoun('widget', [WIDGET])).toBe('widgets')
    expect(searchTypeLabel('widget', [])).toBeUndefined()
    expect(searchTypeNoun('widget', [])).toBeUndefined()
  })

  // A core type is answered from the closed map and never reaches the registry,
  // so an empty one cannot take Queries away and a contributed one cannot
  // shadow it.
  it('answers for a core type whatever the registry holds', () => {
    expect(searchTypeLabel('query', [])).toBe('Queries')
    expect(searchTypeNoun('query', [{ ...WIDGET, type: 'query', label: 'Nope', noun: 'nope' }])).toBe(
      'queries'
    )
  })

  it('returns undefined for a type nothing in this build claims', () => {
    expect(searchTypeLabel('bogus')).toBeUndefined()
    expect(searchTypeNoun('bogus')).toBeUndefined()
  })
})
