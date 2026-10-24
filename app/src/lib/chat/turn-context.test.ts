import { describe, expect, it } from 'vitest'
import { clampTurnContext, TURN_CONTEXT_LIMITS, type TurnContext } from './turn-context'

function source(id: number, name = `Source ${id}`) {
  return { id, name, type: 'pg', syntax: 'sql', viewOnly: false }
}

const instance = { name: 'Meridian Transit', edition: 'CE' as const, features: [], plugins: [], maps: [] }

describe('clampTurnContext', () => {
  it('truncates strings and lists to the sidecar limits', () => {
    const many = Array.from({ length: 120 }, (_, index) => source(index + 1))
    many[0] = source(1, 'x'.repeat(500))
    const params = Array.from({ length: 12 }, (_, index) => ({ name: `p${index}`, type: 'text', values: [] }))
    const context: TurnContext = {
      instance,
      dataSources: many,
      readyQueries: [
        { choiceId: 'map', queryId: 1, name: 'Q', dataSourceId: 2, visualizationId: 3, params, more: false },
      ],
    }
    const clamped = clampTurnContext(context)
    expect(clamped.dataSources).toHaveLength(TURN_CONTEXT_LIMITS.dataSources)
    expect(clamped.dataSources?.[0].name).toHaveLength(255)
    expect(clamped.readyQueries?.[0].params).toHaveLength(10)
  })

  it('drops entries that still fail their schema and keeps the rest', () => {
    const clamped = clampTurnContext({ instance, dataSources: [source(0), source(2)], readyQueries: [] })
    expect(clamped.dataSources?.map((one) => one.id)).toEqual([2])
  })

  it('drops an instance profile that fails its schema rather than the turn', () => {
    const clamped = clampTurnContext({
      instance: { ...instance, edition: 'PRO' as never },
      dataSources: [source(2)],
      readyQueries: [],
    })
    expect(clamped.instance).toBeUndefined()
    expect(clamped.dataSources).toHaveLength(1)
  })
})
