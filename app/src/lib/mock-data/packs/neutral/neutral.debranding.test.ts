/**
 * The neutral pack's publication guard: a stock public build bundles this pack,
 * so anything naming a real tenant or a real piece of our infrastructure ships
 * with the product. Structural parity with the LA pack is neutral.test.ts.
 *
 * The KPI and report fixtures run the same assertions in ./kpis.test.ts and
 * ./reports.test.ts: they are not exported from ./index, so this file cannot
 * reach them.
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

// Every exported fixture collection, not a hand-picked few: a leak can sit in
// any of them.
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

  // Our own infrastructure hostnames leak past the customer-name check above,
  // so any host a stranger could resolve back to us belongs in this list.
  // A list of real domains, not a rule like "no URL outside example.com": the
  // connectors legitimately document public vendor endpoints.
  it('names none of our own or our customers real domains', () => {
    const everything = JSON.stringify(ALL_FIXTURES).toLowerCase()

    for (const domain of ['gurunetwork.ai', 'onriits.net', 'riits.internal']) {
      expect(everything, `neutral pack must not name ${domain}`).not.toContain(domain)
    }
  })
})
