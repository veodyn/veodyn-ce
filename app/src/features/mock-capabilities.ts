import type { FeedCapabilities, StandardCapability } from '@/types/published-feed'
import { FEATURES } from './generated-registry'
import { featureList } from './index'
import type { FeatureDescriptor, MockStandardWidening } from './types'

function standardWidenedBy(
  standard: StandardCapability,
  widenings: MockStandardWidening[]
): StandardCapability {
  const namingThisStandard = widenings.filter(
    (widening) => widening.standard === standard.standard
  )
  if (namingThisStandard.length === 0) return standard

  const entities = [...standard.entities]
  const entityNeeds = { ...standard.entityNeeds }
  for (const widening of namingThisStandard) {
    for (const entity of widening.entities) {
      if (!entities.includes(entity)) entities.push(entity)
      if (Object.hasOwn(widening.entityNeeds, entity)) {
        entityNeeds[entity] = widening.entityNeeds[entity]
      }
    }
  }
  return { ...standard, entities, entityNeeds }
}

export function widenedCapabilities(
  communityRegistry: FeedCapabilities,
  registry: Record<string, FeatureDescriptor> = FEATURES
): FeedCapabilities {
  const widenings = featureList(registry).flatMap((feature) => feature.mockCapabilities ?? [])
  if (widenings.length === 0) return communityRegistry
  return {
    standards: communityRegistry.standards.map((standard) =>
      standardWidenedBy(standard, widenings)
    ),
  }
}
