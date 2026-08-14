import { describe, expect, it } from 'vitest'
import { DEFAULT_ENTITY, resolveEntitySelection } from './entity-selection'

describe('resolveEntitySelection', () => {
  it('renders the community default as a fact while capabilities are still loading', () => {
    expect(resolveEntitySelection(undefined, undefined, null)).toEqual({
      isPicker: false,
      entity: DEFAULT_ENTITY,
      options: [DEFAULT_ENTITY],
    })
  })

  it('never renders a picker while capabilities are unresolved, even mid-edit', () => {
    // A failed lookup and a still-loading one both arrive here as `undefined`,
    // so there is no second input to vary and the previous version of this test
    // compared `resolveEntitySelection(...)` to the identical call: a
    // tautology that a total regression would have passed.
    //
    // What is actually worth pinning is that `undefined` cannot produce a
    // picker down ANY path, including the one where an edit supplies an entity
    // and a reader has already picked something. Those two inputs drive picker
    // mode when the registry is known, so they are where a careless refactor
    // would let a picker escape with no options behind it.
    const midEdit = resolveEntitySelection(undefined, 'trip_updates', 'service_alerts')

    expect(midEdit.isPicker).toBe(false)
    expect(midEdit.entity).toBe('trip_updates')
    expect(midEdit.options).toEqual(['trip_updates'])
  })

  it('renders the single registered entity as a fact, not a picker', () => {
    expect(resolveEntitySelection(['vehicle_positions'], undefined, null)).toEqual({
      isPicker: false,
      entity: 'vehicle_positions',
      options: ['vehicle_positions'],
    })
  })

  it('renders a picker once more than one entity is registered', () => {
    const result = resolveEntitySelection(['vehicle_positions', 'trip_updates'], undefined, null)
    expect(result.isPicker).toBe(true)
    expect(result.options).toEqual(['vehicle_positions', 'trip_updates'])
  })

  it('defaults the picker to the first registered entity with nothing picked yet', () => {
    const result = resolveEntitySelection(['vehicle_positions', 'trip_updates'], undefined, null)
    expect(result.entity).toBe('vehicle_positions')
  })

  it('the picker prefers what the reader picked over the initial and the registry order', () => {
    const result = resolveEntitySelection(
      ['vehicle_positions', 'trip_updates', 'service_alerts'],
      'vehicle_positions',
      'service_alerts'
    )
    expect(result.entity).toBe('service_alerts')
  })

  it('the picker falls back to the entity being edited when nothing new was picked yet', () => {
    const result = resolveEntitySelection(
      ['vehicle_positions', 'trip_updates'],
      'trip_updates',
      null
    )
    expect(result.entity).toBe('trip_updates')
  })

  it('an edit shows the binding own entity as the fact even if the registry has narrowed since', () => {
    // The downgrade case design section 4 covers: a binding created under an
    // edition that registered trip_updates, now running on a build whose
    // registry holds only vehicle_positions. The fact must still name what
    // this binding actually is, not the current registry's one entry.
    const result = resolveEntitySelection(['vehicle_positions'], 'trip_updates', null)
    expect(result).toEqual({ isPicker: false, entity: 'trip_updates', options: ['vehicle_positions'] })
  })
})
