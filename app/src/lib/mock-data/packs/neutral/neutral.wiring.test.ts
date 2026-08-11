import { describe, expect, it } from 'vitest'
import { mockDashboards, mockQueries, mockQueryResults } from './index'
import { CORE_VISUALIZATIONS } from '@/lib/visualizations'

// Split out of neutral.test.ts, which is about the pack's shape (ids, keys,
// lengths). These tests are about whether fixtures actually point at each
// other correctly: a widget referencing a query, a report block referencing
// a KPI, a {{ref}} token resolving against real data. They used to run
// against both the neutral and the LA pack; LA is gone, so each check now
// runs once, against the pack this file owns.
//
// The KPI and report wiring lives in ./kpis.test.ts and ./reports.test.ts,
// with the fixtures those checks read; see the note in neutral.test.ts.
describe('neutral demo pack, cross-fixture wiring', () => {
  // The gallery only earns its keep if every widget on it actually resolves:
  // a widget pointing at a missing query, or a query whose result id is not
  // in the pack, renders an empty panel that looks like a broken renderer.
  it('wires every gallery widget to a query and a result that exist', () => {
    const gallery = mockDashboards.find((d) => d.id === 5)
    // Derived, not a count to bump: one widget per type the gallery carries,
    // so a duplicate widget fails here rather than passing a literal that
    // somebody remembered to increment.
    const galleryTypes = new Set((gallery?.widgets ?? []).map((w) => w.visualization?.type))
    expect(gallery?.widgets.length).toBe(galleryTypes.size)
    expect(galleryTypes.size).toBeGreaterThan(0)

    for (const widget of gallery?.widgets ?? []) {
      const query = mockQueries.find((q) => q.id === widget.visualization?.query.id)
      const resultId = query?.latest_query_data_id
      const hasResult = resultId != null && mockQueryResults[resultId] != null
      // The widget id sits in the asserted value, not only in a message, so
      // a failure names the widget instead of printing "expected false".
      expect(`${widget.id}: ${query ? 'query ok' : 'query MISSING'}`).toBe(`${widget.id}: query ok`)
      expect(`${widget.id}: ${hasResult ? 'result ok' : 'result MISSING'}`).toBe(`${widget.id}: result ok`)
    }
  })

  /**
   * Every registered type has a fixture somewhere in the pack.
   *
   * Read off the REGISTRY rather than from a list here. Cross-model review
   * caught the first version of this doing the opposite: it claimed that adding
   * a renderer without a fixture would be detected, while comparing the gallery
   * against a hand-written list of type names that a new registration cannot
   * change. That guard could not fail, which is the one defect class this whole
   * change set exists to close.
   *
   * "Somewhere in the pack", not "on the gallery", because the four types that
   * predate the gallery (chart, table, counter, map) have their fixtures on the
   * subject-matter dashboards, and moving them would be churn for a guard's
   * convenience.
   */
  it('gives every registered visualization type a fixture', () => {
    const registered = CORE_VISUALIZATIONS.map((plugin) => plugin.type)
    expect(registered.length).toBeGreaterThan(10)

    const withFixtures = new Set([
      ...mockQueries.flatMap((q) => q.visualizations.map((v) => v.type)),
      ...mockDashboards.flatMap((d) => d.widgets.map((w) => w.visualization?.type)),
    ])

    for (const type of registered) {
      // The type name is in the asserted value, not only in a message, so a
      // failure says which type is missing a fixture.
      expect(`${type}: ${withFixtures.has(type) ? 'has a fixture' : 'NO FIXTURE'}`).toBe(
        `${type}: has a fixture`,
      )
    }
  })

})
