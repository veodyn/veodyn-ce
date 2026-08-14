// The entity a binding form treats as selected, and whether it should render
// as an editable picker rather than a stated fact. Pulled out of
// feed-form.tsx so this derivation is testable on its own, with no rendering
// and no TanStack Query timing to fake.
//
// Design section 4, "One consequence, and it is a good one": the same form
// serves both editions. One registered entity is the community case and
// renders as a fact; more than one means a pack widened the registry and the
// form renders a picker instead.

/**
 * What a create form defaults to before capabilities have resolved, or if
 * they never do: the one entity services/feed_registry.py always seeds.
 */
export const DEFAULT_ENTITY = 'vehicle_positions'

export interface EntitySelection {
  /** Whether to render a picker rather than a stated fact. */
  isPicker: boolean
  /** The entity to submit, and to show as the fact when not a picker. */
  entity: string
  /** The full registered list. Only meaningful when isPicker is true. */
  options: string[]
}

/**
 * `registeredEntities` is `undefined` for two states at once on purpose: the
 * capabilities lookup still loading, and it having failed. Both degrade to
 * the single-fact form rather than an empty picker or a spinner blocking the
 * whole form, because a community deployment has exactly one entity and a
 * slow or failed secondary request must never take that away.
 *
 * `initialEntity` is the binding's own committed value on an edit, and it
 * wins over whatever the registry currently says: a private feed carried down
 * from an edition that registered more entities still shows the entity it was
 * actually bound to, not a value invented from the current registry. This is
 * the same fail-closed direction the design's "downgrade fails closed"
 * section describes for the write and serving paths.
 *
 * `pickedEntity` is the reader's own choice in picker mode, `null` until they
 * pick one.
 */
export function resolveEntitySelection(
  registeredEntities: string[] | undefined,
  initialEntity: string | undefined,
  pickedEntity: string | null
): EntitySelection {
  if (registeredEntities !== undefined && registeredEntities.length > 1) {
    const entity = pickedEntity ?? initialEntity ?? registeredEntities[0]
    return { isPicker: true, entity, options: registeredEntities }
  }
  const entity = initialEntity ?? registeredEntities?.[0] ?? DEFAULT_ENTITY
  return { isPicker: false, entity, options: registeredEntities ?? [entity] }
}
