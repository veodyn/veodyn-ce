// The entity a binding form treats as selected, and whether it should render as
// an editable picker rather than a stated fact. One registered entity is the
// community case and renders as a fact; more than one means a pack widened the
// registry (design section 4).
import type { EntityNeeds, FeedCapabilities, FeedStandard } from '@/types/published-feed'

/**
 * What a create form defaults to before capabilities have resolved, or if they
 * never do: the entity services/feed_registry.py seeds for that standard.
 */
export const DEFAULT_ENTITY_BY_STANDARD: Record<FeedStandard, string> = {
  'gtfs-rt': 'vehicle_positions',
  gbfs: 'stations',
}

export interface EntitySelection {
  /** Whether to render a picker rather than a stated fact. */
  isPicker: boolean
  /** The entity to submit, and to show as the fact when not a picker. */
  entity: string
  /** The full registered list. Only meaningful when isPicker is true. */
  options: string[]
}

/**
 * `registeredEntities` is `undefined` for two states at once: the capabilities
 * lookup still loading, and it having failed. Both degrade to the single-fact
 * form rather than an empty picker or a blocking spinner.
 *
 * `initialEntity` is the binding's committed value on an edit and wins over the
 * current registry, so a feed carried down from an edition that registered more
 * entities still shows what it was bound to (the design's "downgrade fails
 * closed").
 *
 * `pickedEntity` is the reader's own choice in picker mode, `null` until they
 * pick one.
 */
export function fallbackEntityNeeds(standard: FeedStandard): EntityNeeds {
  return {
    query: true,
    staticReference: standard === 'gtfs-rt',
    columnMap: true,
    retirementOnFailure: false,
  }
}

export function resolveEntityNeeds(
  entityNeeds: Record<string, EntityNeeds> | undefined,
  entity: string,
  standard: FeedStandard
): EntityNeeds {
  return entityNeeds?.[entity] ?? fallbackEntityNeeds(standard)
}

export function standardRegistering(
  capabilities: FeedCapabilities | undefined,
  entity: string | undefined
): FeedStandard | null {
  if (capabilities === undefined || entity === undefined) return null
  const owner = capabilities.standards.find((entry) => entry.entities.includes(entity))?.standard
  return owner === 'gtfs-rt' || owner === 'gbfs' ? owner : null
}

export function resolveEntitySelection(
  registeredEntities: string[] | undefined,
  initialEntity: string | undefined,
  pickedEntity: string | null,
  standard: FeedStandard
): EntitySelection {
  if (registeredEntities !== undefined && registeredEntities.length > 1) {
    const picked = pickedEntity !== null && registeredEntities.includes(pickedEntity) ? pickedEntity : null
    const entity = picked ?? initialEntity ?? registeredEntities[0]
    return { isPicker: true, entity, options: registeredEntities }
  }
  const entity = initialEntity ?? registeredEntities?.[0] ?? DEFAULT_ENTITY_BY_STANDARD[standard]
  return { isPicker: false, entity, options: registeredEntities ?? [entity] }
}
