import { describe, expect, it } from 'vitest'
import { dashboard, query, type Args, resolve, transportFor } from './dashboard-edit.fixtures'

describe('resolveDashboardEdit: parameter mappings', () => {
  const add = (parameterMappings: NonNullable<Extract<NonNullable<Args['operations']>[number], { op: 'add' }>['parameterMappings']>) => ({
    operations: [{ op: 'add' as const, queryId: 7, visualizationId: 70, parameterMappings }],
  })

  it('completes a mapping with the parameter title and default value', async () => {
    const result = await resolve(add({ start: { type: 'dashboard-add-new', mapTo: 'start' } }))
    expect(result.problems).toEqual([])
    expect(result.operations?.[0]).toMatchObject({
      parameterMappings: { start: { type: 'dashboard-add-new', mapTo: 'start', value: '2026-01-01', title: 'Start date' } },
    })
  })

  it('keeps an explicit value and an explicit null', async () => {
    const result = await resolve(add({ start: { type: 'static-value', value: '2026-02-02' } }))
    expect(result.operations?.[0]).toMatchObject({ parameterMappings: { start: { type: 'static-value', value: '2026-02-02' } } })
    const nulled = await resolve(add({ start: { type: 'widget-level', value: null } }))
    expect(nulled.operations?.[0]).toMatchObject({ parameterMappings: { start: { type: 'widget-level', value: null } } })
  })

  it('reports a key that is not a parameter of the query, and mappings that do not fit their type', async () => {
    const unknown = await resolve(add({ nope: { type: 'widget-level' } }))
    expect(unknown.problems).toEqual(['Operation 1: query 7 has no parameter nope. Its parameters are: start.'])
    const noValue = await resolve(add({ start: { type: 'static-value' } }))
    expect(noValue.problems).toEqual(['Operation 1: the static-value mapping for start needs a value.'])
    const noMapTo = await resolve(add({ start: { type: 'dashboard-map-to-existing' } }))
    expect(noMapTo.problems).toEqual(['Operation 1: the dashboard-map-to-existing mapping for start needs mapTo.'])
  })

  it('passes mappings on a query draft through unchecked', async () => {
    const result = await resolve({
      operations: [{ op: 'add', queryDraftId: 'd-1', parameterMappings: { x: { type: 'widget-level' } } }],
    })
    expect(result.problems).toEqual([])
    expect(result.operations?.[0]).toMatchObject({ parameterMappings: { x: { type: 'widget-level' } } })
  })

  it('clips a problem that names a long parameter list to what the sidecar accepts', async () => {
    const parameters = Array.from({ length: 40 }, (_, index) => ({ name: `parameter_${'x'.repeat(30)}_${index}`, type: 'text' }))
    const transport = transportFor(dashboard(), { 7: query(7, { options: { parameters } }) })
    const result = await resolve(add({ nope: { type: 'widget-level' } }), transport)
    expect(result.problems).toHaveLength(1)
    expect(result.problems?.[0]).toHaveLength(500)
  })
})
