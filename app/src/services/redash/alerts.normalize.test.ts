// What normalizeAlert does with the shape Redash actually sends, reached
// through list() and get() because the normalizer itself is private.
//
// The wire shape and the shape this app renders differ in three places: a real
// alert carries its query inline and has no flat `query_id`, it has no
// `destinations` field at all (those live in the subscriptions sub-resource),
// and `muted` may be missing from options. Each of those is a field the alerts
// table reads directly, so a gap shows up as a blank cell rather than an error.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { get as getAlert, list } from './alerts'
import { ApiError } from '@/services/api-client'

const get = vi.fn()

vi.mock('@/services/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api-client')>()),
  redashApi: {
    get: (path: string, options?: unknown) => get(path, options),
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

const RAW = {
  id: 2,
  name: 'Battery low',
  options: { column: 'soc', op: '<', value: 20, muted: false },
  state: 'ok' as const,
  last_triggered_at: null,
  rearm: 3600,
  user: { id: 1, name: 'Admin', email: 'admin@example.com' },
  query: { id: 12, name: 'Fleet battery', data_source_id: 1 },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
}

beforeEach(() => {
  get.mockReset()
})

describe('alerts.list', () => {
  it('reads the collection', async () => {
    get.mockResolvedValue([])

    await list()

    expect(get).toHaveBeenCalledWith('alerts', undefined)
  })

  it('normalizes every alert in the array, not just the first', async () => {
    get.mockResolvedValue([
      { ...RAW, id: 1, options: { column: 'a', op: '<', value: 1 } },
      { ...RAW, id: 2, options: { column: 'b', op: '<', value: 2 } },
    ])

    const alerts = await list()

    expect(alerts.map((a) => a.options.muted)).toEqual([false, false])
  })
})

describe('normalizeAlert flattens the inline query', () => {
  // The list column, the row link and the "run query" action all read
  // `query_id`, and the wire shape has no such field.
  it('lifts the query id out of the nested query', async () => {
    get.mockResolvedValue(RAW)

    const alert = await getAlert(2)

    expect(alert?.query_id).toBe(12)
  })

  it('keeps the whole inline query so the row can name it', async () => {
    get.mockResolvedValue(RAW)

    const alert = await getAlert(2)

    expect(alert?.query).toEqual({ id: 12, name: 'Fleet battery', data_source_id: 1 })
  })

  // An alert whose query was deleted still comes back. Rendering it must not
  // crash on `query.name`, so the placeholder is an object, not undefined.
  it('stands in an empty query when the payload has none', async () => {
    get.mockResolvedValue({ ...RAW, query: undefined })

    const alert = await getAlert(2)

    expect(alert?.query_id).toBe(0)
    expect(alert?.query).toEqual({ id: 0, name: '', data_source_id: 0 })
  })
})

describe('normalizeAlert fills in the option and state defaults', () => {
  // Mute is a sub-resource, not an options flag, so `muted` can be absent on
  // the wire. The mute toggle is a checkbox and undefined renders it
  // indeterminate.
  it('defaults muted to false when options do not carry it', async () => {
    get.mockResolvedValue({ ...RAW, options: { column: 'soc', op: '<', value: 20 } })

    const alert = await getAlert(2)

    expect(alert?.options.muted).toBe(false)
  })

  it('keeps an explicit muted: true', async () => {
    get.mockResolvedValue({ ...RAW, options: { ...RAW.options, muted: true } })

    const alert = await getAlert(2)

    expect(alert?.options.muted).toBe(true)
  })

  // The rest of the options blob is spread through, which is what carries the
  // KPI label and the custom subject a managed alert depends on.
  it('keeps the other option keys alongside the muted default', async () => {
    get.mockResolvedValue({
      ...RAW,
      options: { column: 'soc', op: '<', value: 20, selector: 'last', kpi_id: 'fleet-soc' },
    })

    const alert = await getAlert(2)

    expect(alert?.options).toEqual({
      column: 'soc',
      op: '<',
      value: 20,
      selector: 'last',
      kpi_id: 'fleet-soc',
      muted: false,
    })
  })

  it('reads a missing state as unknown rather than leaving it undefined', async () => {
    get.mockResolvedValue({ ...RAW, state: undefined })

    const alert = await getAlert(2)

    expect(alert?.state).toBe('unknown')
  })

  it('keeps a triggered state and its timestamp', async () => {
    get.mockResolvedValue({ ...RAW, state: 'triggered', last_triggered_at: '2026-02-01T00:00:00Z' })

    const alert = await getAlert(2)

    expect(alert?.state).toBe('triggered')
    expect(alert?.last_triggered_at).toBe('2026-02-01T00:00:00Z')
  })

  it('turns an absent rearm into null, which means do not re-arm', async () => {
    get.mockResolvedValue({ ...RAW, rearm: undefined })

    const alert = await getAlert(2)

    expect(alert?.rearm).toBeNull()
  })

  it('keeps a rearm interval of zero rather than nulling it', async () => {
    get.mockResolvedValue({ ...RAW, rearm: 0 })

    const alert = await getAlert(2)

    expect(alert?.rearm).toBe(0)
  })

  // Deliberately empty: there is no destinations field on the wire and filling
  // it would cost one subscriptions request per alert in list(). Every real
  // consumer reads the attached set from useAlertSubscriptions instead. Pinned
  // so that "the destinations column is blank" is a known answer rather than a
  // bug hunt.
  it('leaves destinations empty even when the payload smuggles some in', async () => {
    get.mockResolvedValue({ ...RAW, destinations: [{ id: 1, name: 'ops', type: 'slack' }] })

    const alert = await getAlert(2)

    expect(alert?.destinations).toEqual([])
  })

  it('keeps the alert owner', async () => {
    get.mockResolvedValue(RAW)

    const alert = await getAlert(2)

    expect(alert?.user).toEqual({ id: 1, name: 'Admin', email: 'admin@example.com' })
  })
})

describe('alerts.get on a missing alert', () => {
  it('answers null for a 404', async () => {
    get.mockRejectedValue(new ApiError(404, 'Not found'))

    await expect(getAlert(999)).resolves.toBeNull()
  })

  it('rethrows anything that is not a 404', async () => {
    get.mockRejectedValue(new ApiError(500, 'Server error'))

    await expect(getAlert(2)).rejects.toThrow('Server error')
  })
})
