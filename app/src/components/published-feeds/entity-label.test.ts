import { describe, expect, it } from 'vitest'
import { entityLabel } from './entity-label'

describe('entityLabel', () => {
  it('reads a community entity the way the list already read it', () => {
    expect(entityLabel('vehicle_positions')).toBe('vehicle positions')
    expect(entityLabel('stations')).toBe('stations')
  })

  it('names an entity registered by an installed pack rather than dropping it', () => {
    expect(entityLabel('service_alerts')).toBe('service alerts')
    expect(entityLabel('trip_updates')).toBe('trip updates')
  })

  it('never answers with nothing, whatever the wire carries', () => {
    expect(entityLabel('constructor')).toBe('constructor')
    expect(entityLabel('toString')).toBe('toString')
  })
})
