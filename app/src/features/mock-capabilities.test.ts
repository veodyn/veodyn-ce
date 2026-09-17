import { describe, expect, it } from 'vitest'
import type { FeedCapabilities } from '@/types/published-feed'
import { widenedCapabilities } from './mock-capabilities'
import type { FeatureDescriptor, MockStandardWidening } from './types'

const QUERY_BACKED = { query: true, staticReference: true, columnMap: true, retirementOnFailure: false }
const QUERYLESS = { query: false, staticReference: true, columnMap: false, retirementOnFailure: true }

const COMMUNITY: FeedCapabilities = {
  standards: [
    {
      standard: 'gbfs',
      versions: ['2.3'],
      entities: ['stations'],
      entityNeeds: { stations: QUERY_BACKED },
      timezones: ['UTC'],
    },
    {
      standard: 'gtfs-rt',
      versions: ['2.0'],
      entities: ['vehicle_positions'],
      entityNeeds: { vehicle_positions: QUERY_BACKED },
      timezones: [],
    },
  ],
}

function featureWith(id: string, mockCapabilities: MockStandardWidening[]): FeatureDescriptor {
  return { id, nav: [], routes: [], mockCapabilities }
}

const ALERTS = featureWith('messages', [
  {
    standard: 'gtfs-rt',
    entities: ['service_alerts'],
    entityNeeds: { service_alerts: QUERYLESS },
  },
])

describe('widenedCapabilities', () => {
  it('hands back the community answer itself when nothing is installed', () => {
    expect(widenedCapabilities(COMMUNITY, {})).toBe(COMMUNITY)
  })

  it('hands back the community answer itself when no installed feature widens it', () => {
    const registry = { alerts: { id: 'alerts', nav: [], routes: [] } }
    expect(widenedCapabilities(COMMUNITY, registry)).toBe(COMMUNITY)
  })

  it('registers the entity an installed feature produces, and what it consumes', () => {
    const widened = widenedCapabilities(COMMUNITY, { messages: ALERTS })
    const gtfsRt = widened.standards.find((entry) => entry.standard === 'gtfs-rt')

    expect(gtfsRt?.entities).toEqual(['vehicle_positions', 'service_alerts'])
    expect(gtfsRt?.entityNeeds.service_alerts).toEqual(QUERYLESS)
  })

  it('leaves the community entity first, so the picker still defaults to it', () => {
    const widened = widenedCapabilities(COMMUNITY, { messages: ALERTS })
    expect(widened.standards.find((entry) => entry.standard === 'gtfs-rt')?.entities[0]).toBe(
      'vehicle_positions'
    )
  })

  it('leaves the standards nobody widened untouched, versions and timezones included', () => {
    const widened = widenedCapabilities(COMMUNITY, { messages: ALERTS })
    expect(widened.standards.find((entry) => entry.standard === 'gbfs')).toEqual(
      COMMUNITY.standards[0]
    )
  })

  it('ignores a widening naming a standard this build does not declare', () => {
    const registry = {
      siri: featureWith('siri', [
        { standard: 'siri', entities: ['situations'], entityNeeds: { situations: QUERYLESS } },
      ]),
    }

    expect(widenedCapabilities(COMMUNITY, registry).standards.map((entry) => entry.standard)).toEqual([
      'gbfs',
      'gtfs-rt',
    ])
  })

  it('does not mutate the community answer it was handed', () => {
    widenedCapabilities(COMMUNITY, { messages: ALERTS })

    expect(COMMUNITY.standards[1].entities).toEqual(['vehicle_positions'])
    expect(COMMUNITY.standards[1].entityNeeds).toEqual({ vehicle_positions: QUERY_BACKED })
  })

  it('takes both features widening one standard, in featureList order', () => {
    const registry = {
      messages: ALERTS,
      trips: featureWith('trips', [
        {
          standard: 'gtfs-rt',
          entities: ['trip_updates'],
          entityNeeds: { trip_updates: QUERY_BACKED },
        },
      ]),
    }
    const widened = widenedCapabilities(COMMUNITY, registry)

    expect(widened.standards.find((entry) => entry.standard === 'gtfs-rt')?.entities).toEqual([
      'vehicle_positions',
      'service_alerts',
      'trip_updates',
    ])
  })
})
