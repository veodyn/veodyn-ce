// The entity a binding form treats as selected, and whether it should render as
// an editable picker rather than a stated fact. One registered entity is the
// community case and renders as a fact; more than one means a pack widened the
// registry (design section 4).
import type { EntityNeeds, FeedStandard } from '@/types/published-feed'

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
/**
 * What the form asks for while capabilities are unresolved, and if they never
 * resolve: exactly what every entity a community build registers needs, so the
 * degraded form is the form this repository shipped before the registry
 * answered the question. Never "needs nothing", which would offer to create a
 * binding with no query behind it that no producer can publish.
 */
export function fallbackEntityNeeds(standard: FeedStandard): EntityNeeds {
  return { query: true, staticReference: standard === 'gtfs-rt', columnMap: true }
}

/**
 * What this entity's producer consumes, from the same capabilities read that
 * decides whether the entity control is a picker. `entityNeeds` is undefined
 * for a lookup still loading and for one that failed, and an entity missing
 * from it is one this deployment does not register at all, which an edit of a
 * binding carried down from a wider edition can still name.
 */
export function resolveEntityNeeds(
  entityNeeds: Record<string, EntityNeeds> | undefined,
  entity: string,
  standard: FeedStandard
): EntityNeeds {
  return entityNeeds?.[entity] ?? fallbackEntityNeeds(standard)
}

export function resolveEntitySelection(
  registeredEntities: string[] | undefined,
  initialEntity: string | undefined,
  pickedEntity: string | null,
  standard: FeedStandard
): EntitySelection {
  if (registeredEntities !== undefined && registeredEntities.length > 1) {
    const entity = pickedEntity ?? initialEntity ?? registeredEntities[0]
    return { isPicker: true, entity, options: registeredEntities }
  }
  const entity = initialEntity ?? registeredEntities?.[0] ?? DEFAULT_ENTITY_BY_STANDARD[standard]
  return { isPicker: false, entity, options: registeredEntities ?? [entity] }
}
