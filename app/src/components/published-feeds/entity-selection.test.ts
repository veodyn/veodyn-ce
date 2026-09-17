import { describe, expect, it } from 'vitest'
import { DEFAULT_ENTITY_BY_STANDARD, resolveEntityNeeds, resolveEntitySelection } from './entity-selection'

const GTFS_RT_DEFAULT = DEFAULT_ENTITY_BY_STANDARD['gtfs-rt']

describe('resolveEntitySelection', () => {
  it('renders the community default as a fact while capabilities are still loading', () => {
    expect(resolveEntitySelection(undefined, undefined, null, 'gtfs-rt')).toEqual({
      isPicker: false,
      entity: GTFS_RT_DEFAULT,
      options: [GTFS_RT_DEFAULT],
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
    const midEdit = resolveEntitySelection(undefined, 'trip_updates', 'service_alerts', 'gtfs-rt')

    expect(midEdit.isPicker).toBe(false)
    expect(midEdit.entity).toBe('trip_updates')
    expect(midEdit.options).toEqual(['trip_updates'])
  })

  it('renders the single registered entity as a fact, not a picker', () => {
    expect(resolveEntitySelection(['vehicle_positions'], undefined, null, 'gtfs-rt')).toEqual({
      isPicker: false,
      entity: 'vehicle_positions',
      options: ['vehicle_positions'],
    })
  })

  it('renders a picker once more than one entity is registered', () => {
    const result = resolveEntitySelection(['vehicle_positions', 'trip_updates'], undefined, null, 'gtfs-rt')
    expect(result.isPicker).toBe(true)
    expect(result.options).toEqual(['vehicle_positions', 'trip_updates'])
  })

  it('defaults the picker to the first registered entity with nothing picked yet', () => {
    const result = resolveEntitySelection(['vehicle_positions', 'trip_updates'], undefined, null, 'gtfs-rt')
    expect(result.entity).toBe('vehicle_positions')
  })

  it('the picker prefers what the reader picked over the initial and the registry order', () => {
    const result = resolveEntitySelection(
      ['vehicle_positions', 'trip_updates', 'service_alerts'],
      'vehicle_positions',
      'service_alerts',
      'gtfs-rt'
    )
    expect(result.entity).toBe('service_alerts')
  })

  it('the picker falls back to the entity being edited when nothing new was picked yet', () => {
    const result = resolveEntitySelection(
      ['vehicle_positions', 'trip_updates'],
      'trip_updates',
      null,
      'gtfs-rt'
    )
    expect(result.entity).toBe('trip_updates')
  })

  it('an edit shows the binding own entity as the fact even if the registry has narrowed since', () => {
    // The downgrade case design section 4 covers: a binding created under an
    // edition that registered trip_updates, now running on a build whose
    // registry holds only vehicle_positions. The fact must still name what
    // this binding actually is, not the current registry's one entry.
    const result = resolveEntitySelection(['vehicle_positions'], 'trip_updates', null, 'gtfs-rt')
    expect(result).toEqual({ isPicker: false, entity: 'trip_updates', options: ['vehicle_positions'] })
  })

  it('falls back to the standard own seeded entity, not always the gtfs-rt one', () => {
    // The default is per standard now. A gbfs create form with capabilities
    // still loading must show `stations`, not `vehicle_positions`, which is a
    // value its own API would refuse.
    const result = resolveEntitySelection(undefined, undefined, null, 'gbfs')

    expect(result).toEqual({ isPicker: false, entity: 'stations', options: ['stations'] })
  })
})

describe('resolveEntityNeeds', () => {
  const QUERYLESS = { query: false, staticReference: false, columnMap: false }

  it('reports what the registry says for the entity, not what its standard usually needs', () => {
    const needs = resolveEntityNeeds({ bulletins: QUERYLESS }, 'bulletins', 'gtfs-rt')

    expect(needs).toEqual(QUERYLESS)
  })

  it('answers per entity, so one queryless entity does not excuse the one beside it', () => {
    const registry = {
      bulletins: QUERYLESS,
      vehicle_positions: { query: true, staticReference: true, columnMap: true },
    }

    expect(resolveEntityNeeds(registry, 'vehicle_positions', 'gtfs-rt').query).toBe(true)
  })

  it('asks for everything while the capabilities lookup is unresolved', () => {
    // Undefined is both "still loading" and "the request failed", the same as
    // for the entity control. Reading either as "needs nothing" would offer a
    // binding with no query behind it that no producer can publish.
    expect(resolveEntityNeeds(undefined, 'vehicle_positions', 'gtfs-rt')).toEqual({
      query: true,
      staticReference: true,
      columnMap: true,
    })
  })

  it('asks for no static schedule under gbfs, which has nowhere to put one', () => {
    expect(resolveEntityNeeds(undefined, 'stations', 'gbfs')).toEqual({
      query: true,
      staticReference: false,
      columnMap: true,
    })
  })

  it('falls back for an entity this deployment does not register, such as one an edit names', () => {
    const needs = resolveEntityNeeds({ bulletins: QUERYLESS }, 'trip_updates', 'gtfs-rt')

    expect(needs.query).toBe(true)
    expect(needs.columnMap).toBe(true)
  })
})
