import { describe, expect, it } from 'vitest'
import { draftKind } from './draft-kinds'

const LIVE_ROUTE = { kind: 'existing', queryId: 137, visualizationId: 240, title: 'Live route' }

function parsed(item: Record<string, unknown>) {
  return draftKind('dashboard').parse({ name: 'Union Station & Route 720', description: '', items: [item] })
}

describe('a dashboard proposal whose existing item carries the previewed parameter values', () => {
  it('parses and keeps the values, so the card still renders', () => {
    const parameters = { route: 'MT720', stops: ['a', 'b'], limit: 5, window: { start: 'd_this_week', end: 'd_now' } }
    expect(parsed({ ...LIVE_ROUTE, parameters })).toEqual({
      name: 'Union Station & Route 720',
      description: '',
      items: [{ ...LIVE_ROUTE, parameters }],
    })
  })

  it('still parses an item without values', () => {
    expect(parsed(LIVE_ROUTE)).not.toBeNull()
  })

  it('refuses a value of a shape no query parameter takes', () => {
    expect(parsed({ ...LIVE_ROUTE, parameters: { route: { nested: true } } })).toBeNull()
  })
})
