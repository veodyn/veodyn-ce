import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cookieReader } from './redash-get'

const redashFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/redash-server', () => ({ redashFetch }))

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const SIGNAL = new AbortController().signal

function source(id: number, overrides: Record<string, unknown> = {}) {
  return { id, name: `Source ${id}`, type: 'sql_x', syntax: 'sql', view_only: false, ...overrides }
}

function serve(sources: unknown[], schemas: Record<number, () => Response>) {
  redashFetch.mockImplementation(async (path: string) => {
    if (path === '/api/data_sources') return reply(sources)
    const match = /^\/api\/data_sources\/(\d+)\/schema$/.exec(path)
    if (match) return (schemas[Number(match[1])] ?? (() => reply({ schema: [] })))()
    return reply({}, 404)
  })
}

async function inventory(cookie: string | null = 'session=a') {
  vi.resetModules()
  const { dataSourceInventory } = await import('./inventory')
  return dataSourceInventory(cookieReader(cookie), SIGNAL)
}

beforeEach(() => {
  redashFetch.mockReset()
})

describe('dataSourceInventory', () => {
  it('json_source_resource_names_are_parsed_from_schema_entries', async () => {
    serve([source(3, { type: 'json', syntax: 'json' })], {
      3: () =>
        reply({
          schema: [
            { name: '1. predictions > params', columns: [] },
            { name: '1. predictions > returns', columns: [] },
            { name: '10. reports > params', columns: [] },
          ],
        }),
    })
    const [entry] = await inventory()
    expect(entry.resources).toEqual(['predictions', 'reports'])
    expect(entry).toMatchObject({ id: 3, name: 'Source 3', type: 'json', syntax: 'json', viewOnly: false })
  })

  it('documentation_entries_are_not_resource_names', async () => {
    serve([source(3, { type: 'json', syntax: 'json' })], {
      3: () =>
        reply({
          schema: [
            { name: '__ Query Examples __', columns: [] },
            { name: '__ Query Format __', columns: [] },
            { name: '1. predictions > params', columns: [] },
            { name: 'stray entry', columns: [] },
          ],
        }),
    })
    const [entry] = await inventory()
    expect(entry.resources).toEqual(['predictions'])
  })

  it('reads_the_sources_with_the_analysts_cookie', async () => {
    serve([source(1)], {})
    await inventory('session=zed')
    expect(redashFetch).toHaveBeenCalledWith('/api/data_sources', expect.objectContaining({ cookie: 'session=zed' }))
  })

  it('sql_sources_carry_no_resource_names_and_no_schema_call', async () => {
    serve([source(1)], {})
    const [entry] = await inventory()
    expect(entry).not.toHaveProperty('resources')
    expect(redashFetch).toHaveBeenCalledTimes(1)
  })

  it('schema_job_response_yields_unknown_resources', async () => {
    serve([source(3, { type: 'json', syntax: 'json' })], { 3: () => reply({ job: { id: 'j1', status: 1 } }) })
    const [entry] = await inventory()
    expect(entry.resources).toBeNull()
  })

  it('one_failing_schema_does_not_drop_other_sources', async () => {
    serve(
      [source(3, { type: 'json', syntax: 'json' }), source(4, { type: 'json', syntax: 'json' }), source(5)],
      {
        3: () => reply({ message: 'boom' }, 500),
        4: () => reply({ schema: [{ name: '2. incidents > returns', columns: [] }] }),
      }
    )
    const entries = await inventory()
    expect(entries.map((entry) => entry.id)).toEqual([3, 4, 5])
    expect(entries[0].resources).toBeNull()
    expect(entries[1].resources).toEqual(['incidents'])
  })

  it('a_schema_call_that_throws_gives_unknown_resources', async () => {
    redashFetch.mockImplementation(async (path: string) => {
      if (path === '/api/data_sources') return reply([source(3, { type: 'json', syntax: 'json' })])
      throw new Error('socket hang up')
    })
    const [entry] = await inventory()
    expect(entry.resources).toBeNull()
  })

  it('results_source_marked_no_schema', async () => {
    serve([source(15, { type: 'results', syntax: 'sql' })], {})
    const [entry] = await inventory()
    expect(entry.noSchema).toBe(true)
    expect(redashFetch).toHaveBeenCalledTimes(1)
  })

  it('view_only_comes_from_node', async () => {
    serve([source(19, { type: 'results', view_only: true })], {})
    const [entry] = await inventory()
    expect(entry.viewOnly).toBe(true)
  })

  it('an_analyst_with_no_sources_gets_an_empty_inventory', async () => {
    serve([], {})
    expect(await inventory()).toEqual([])
  })

  it('a_node_refusal_for_the_list_throws_so_the_builder_can_drop_the_part', async () => {
    redashFetch.mockResolvedValue(reply({ message: 'nope' }, 500))
    await expect(inventory()).rejects.toThrow()
  })

  it('cached_names_not_emitted_for_sources_outside_the_analysts_list', async () => {
    vi.resetModules()
    const { dataSourceInventory } = await import('./inventory')
    serve([source(9, { type: 'json', syntax: 'json' })], {
      9: () => reply({ schema: [{ name: '1. secret_feed > params', columns: [] }] }),
    })
    const first = await dataSourceInventory(cookieReader('session=a'), SIGNAL)
    expect(first[0].resources).toEqual(['secret_feed'])
    serve([source(1)], {})
    const second = await dataSourceInventory(cookieReader('session=b'), SIGNAL)
    expect(second.map((entry) => entry.id)).toEqual([1])
    expect(JSON.stringify(second)).not.toContain('secret_feed')
  })

  it('names_are_cached_per_source_across_analysts', async () => {
    vi.resetModules()
    const { dataSourceInventory } = await import('./inventory')
    serve([source(9, { type: 'json', syntax: 'json' })], {
      9: () => reply({ schema: [{ name: '1. feed > params', columns: [] }] }),
    })
    await dataSourceInventory(cookieReader('session=a'), SIGNAL)
    await dataSourceInventory(cookieReader('session=b'), SIGNAL)
    const schemaCalls = redashFetch.mock.calls.filter(([path]) => String(path).endsWith('/schema'))
    expect(schemaCalls).toHaveLength(1)
  })

  it('a_job_response_is_cached_negatively_so_a_broken_source_is_not_retried_every_turn', async () => {
    vi.resetModules()
    const { dataSourceInventory } = await import('./inventory')
    serve([source(9, { type: 'json', syntax: 'json' })], { 9: () => reply({ job: { id: 'j' } }) })
    await dataSourceInventory(cookieReader('session=a'), SIGNAL)
    const second = await dataSourceInventory(cookieReader('session=b'), SIGNAL)
    expect(second[0].resources).toBeNull()
    const schemaCalls = redashFetch.mock.calls.filter(([path]) => String(path).endsWith('/schema'))
    expect(schemaCalls).toHaveLength(1)
  })

  it('a_failing_schema_is_cached_negatively_too', async () => {
    vi.resetModules()
    const { dataSourceInventory } = await import('./inventory')
    serve([source(9, { type: 'json', syntax: 'json' })], { 9: () => reply({ message: 'boom' }, 500) })
    await dataSourceInventory(cookieReader('session=a'), SIGNAL)
    await dataSourceInventory(cookieReader('session=b'), SIGNAL)
    const schemaCalls = redashFetch.mock.calls.filter(([path]) => String(path).endsWith('/schema'))
    expect(schemaCalls).toHaveLength(1)
  })

  it('the_same_analyst_is_served_the_source_list_from_a_short_cache', async () => {
    vi.resetModules()
    const { dataSourceInventory } = await import('./inventory')
    serve([source(1)], {})
    await dataSourceInventory(cookieReader('session=a'), SIGNAL)
    await dataSourceInventory(cookieReader('session=a'), SIGNAL)
    await dataSourceInventory(cookieReader('session=b'), SIGNAL)
    const lists = redashFetch.mock.calls.filter(([path]) => path === '/api/data_sources')
    expect(lists).toHaveLength(2)
  })

  it('a_failed_list_is_not_cached', async () => {
    vi.resetModules()
    const { dataSourceInventory } = await import('./inventory')
    redashFetch.mockResolvedValueOnce(reply({ message: 'no' }, 500))
    await expect(dataSourceInventory(cookieReader('session=a'), SIGNAL)).rejects.toThrow()
    serve([source(1)], {})
    expect(await dataSourceInventory(cookieReader('session=a'), SIGNAL)).toHaveLength(1)
  })
})
