/**
 * The neutral pack's publication guard.
 *
 * Split out of neutral.test.ts, which is otherwise about structural parity
 * with the LA pack (same ids, same shapes, same widget wiring). That is a
 * fixture-consistency concern and answers "did the two packs drift". These
 * tests answer something different and higher stakes: is this pack safe to
 * ship. The neutral pack is what a stock public build bundles, so anything
 * identifying a real tenant or a real piece of our infrastructure that
 * survives in here goes out with the product.
 *
 * The KPI and report fixtures go through the SAME guard, in ./kpis.test.ts and
 * ./reports.test.ts. They are not exported from ./index any more (they reach
 * the mock store through their features' descriptors), and a community build
 * does not have them at all, so this file cannot name them. Nothing lost its
 * guard: those two files run the identical assertions over the same strings.
 */
import { describe, expect, it } from 'vitest'
import {
  currentUser,
  mockAlerts,
  mockAnnotations,
  mockDashboards,
  mockDataSources,
  mockDataSourceTypes,
  mockDatasets,
  mockDestinations,
  mockDestinationTypes,
  mockDomainHubs,
  mockFeeds,
  mockGroups,
  mockQueries,
  mockQueryResults,
  mockQuerySnippets,
  mockSchema,
  mockUsers,
} from './index'

// Every exported fixture collection, not a hand-picked few. A KPI named after
// the customer, a catalog dataset naming an internal hostname, or a feed
// carrying a real tenant URL would all have passed the version of this file
// that only serialized data sources, dashboards, queries, KPIs and reports:
// datasets, domain hubs, feeds, alerts, users, groups, destinations,
// snippets, schema, annotations and query results were not checked at all.
const ALL_FIXTURES = {
  mockUsers,
  currentUser,
  mockQueries,
  mockQueryResults,
  mockDashboards,
  mockDataSources,
  mockDataSourceTypes,
  mockAlerts,
  mockGroups,
  mockDestinations,
  mockDestinationTypes,
  mockQuerySnippets,
  mockSchema,
  mockDatasets,
  mockDomainHubs,
  mockAnnotations,
  mockFeeds,
}

describe('neutral demo pack, publication guard', () => {
  it('is de-branded: no RIITS/LA references anywhere in the pack', () => {
    const everything = JSON.stringify(ALL_FIXTURES).toLowerCase()

    expect(everything).not.toContain('riits')
  })

  // The customer's name was never the only thing that could leak. This pack
  // carried a real widgets-api-widgets.apps.gurunetwork.ai URL past the check
  // above for as long as that check only grepped for "riits": the host names
  // our own infrastructure rather than the tenant's, so a de-branding test
  // written around the customer could not see it. Any hostname a stranger
  // could resolve back to us belongs here, not just the one customer's.
  //
  // Kept to a list of real domains on purpose. A broader rule such as "no URL
  // outside example.com" would fail on the public vendor endpoints the
  // connectors legitimately document, and a guard that cries wolf gets
  // deleted rather than fixed.
  it('names none of our own or our customers real domains', () => {
    const everything = JSON.stringify(ALL_FIXTURES).toLowerCase()

    for (const domain of ['gurunetwork.ai', 'onriits.net', 'riits.internal']) {
      expect(everything, `neutral pack must not name ${domain}`).not.toContain(domain)
    }
  })
})
