// What the alert writes put on the wire.
//
// Two contracts here are not guessable from the UI. Mute is POST/DELETE on
// /alerts/:id/mute, not an options flag, so setting `options.muted` saves a
// value nothing acts on. And destinations are a separate subscriptions
// sub-resource, so attaching one is a POST of a subscription rather than a
// field on the alert.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { create, listSubscriptions, mute, remove, subscribe, unsubscribe, update } from './alerts'

const get = vi.fn()
const post = vi.fn()
const del = vi.fn()

vi.mock('@/services/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api-client')>()),
  redashApi: {
    get: (path: string, options?: unknown) => get(path, options),
    post: (path: string, data?: unknown) => post(path, data),
    delete: (path: string) => del(path),
  },
}))

const RAW = {
  id: 2,
  name: 'Battery low',
  options: { column: 'soc', op: '<', value: 20, muted: false },
  state: 'ok' as const,
  last_triggered_at: null,
  rearm: null,
  user: { id: 1, name: 'Admin', email: 'admin@example.com' },
  query: { id: 12, name: 'Fleet battery', data_source_id: 1 },
  created_at: '',
  updated_at: '',
}

function bodyOfLastPost(): Record<string, unknown> {
  return post.mock.calls.at(-1)?.[1] as Record<string, unknown>
}

beforeEach(() => {
  get.mockReset()
  post.mockReset()
  del.mockReset()
  get.mockResolvedValue([])
  post.mockResolvedValue(RAW)
  del.mockResolvedValue(undefined)
})

describe('alerts.create', () => {
  it('posts only the four fields the create endpoint accepts', async () => {
    await create({ name: 'Low SOC', query_id: 12, options: RAW.options, rearm: 600 })

    expect(post).toHaveBeenCalledWith('alerts', {
      name: 'Low SOC',
      query_id: 12,
      options: RAW.options,
      rearm: 600,
    })
  })

  // The name is required server-side, so an untitled draft has to arrive with
  // something rather than an empty string.
  it('names an untitled alert rather than sending a blank name', async () => {
    await create({ query_id: 12 })

    expect(bodyOfLastPost().name).toBe('New Alert')
  })

  it('supplies a default condition when the caller sends no options', async () => {
    await create({ query_id: 12 })

    expect(bodyOfLastPost().options).toEqual({ column: '', op: 'greater than', value: 0 })
  })

  it('sends rearm as null rather than omitting it', async () => {
    await create({ query_id: 12 })

    expect(bodyOfLastPost()).toHaveProperty('rearm', null)
  })

  it('normalizes the created alert before returning it', async () => {
    post.mockResolvedValue({ ...RAW, options: { column: 'soc', op: '<', value: 20 } })

    await expect(create({ query_id: 12 })).resolves.toMatchObject({
      query_id: 12,
      options: { muted: false },
      destinations: [],
    })
  })
})

describe('alerts.update', () => {
  it('sends only what the caller changed', async () => {
    await update(2, { name: 'Renamed' })

    expect(post).toHaveBeenCalledWith('alerts/2', { name: 'Renamed' })
  })

  it('sends a changed condition', async () => {
    await update(2, { options: RAW.options })

    expect(post).toHaveBeenCalledWith('alerts/2', { options: RAW.options })
  })

  // Clearing the re-arm interval is a real edit and null is a meaningful value,
  // so it must not be treated as "unchanged".
  it('sends an explicit null rearm', async () => {
    await update(2, { rearm: null })

    expect(post).toHaveBeenCalledWith('alerts/2', { rearm: null })
  })

  it('repoints an alert at a different query', async () => {
    await update(2, { query_id: 99 })

    expect(post).toHaveBeenCalledWith('alerts/2', { query_id: 99 })
  })

  // The whitelist is what keeps a whole normalized alert (state,
  // last_triggered_at, destinations, user) from being posted back.
  it('drops the read-only fields of a round-tripped alert', async () => {
    await update(2, {
      name: 'Renamed',
      state: 'triggered',
      last_triggered_at: '2026-02-01T00:00:00Z',
      destinations: [],
      user: RAW.user,
    })

    expect(post).toHaveBeenCalledWith('alerts/2', { name: 'Renamed' })
  })
})

describe('alerts.remove', () => {
  it('deletes the member path', async () => {
    await remove(2)

    expect(del).toHaveBeenCalledWith('alerts/2')
  })
})

describe('alerts.mute', () => {
  it('posts to the mute sub-resource rather than setting an options flag', async () => {
    await mute(2, true)

    expect(post).toHaveBeenCalledWith('alerts/2/mute', undefined)
    expect(del).not.toHaveBeenCalled()
  })

  it('unmutes by deleting the mute', async () => {
    await mute(2, false)

    expect(del).toHaveBeenCalledWith('alerts/2/mute')
    expect(post).not.toHaveBeenCalled()
  })
})

describe('alert subscriptions', () => {
  it('lists the subscriptions of one alert', async () => {
    await listSubscriptions(2)

    expect(get).toHaveBeenCalledWith('alerts/2/subscriptions', undefined)
  })

  it('attaches a destination by posting a subscription', async () => {
    await subscribe(2, 7)

    expect(post).toHaveBeenCalledWith('alerts/2/subscriptions', { destination_id: 7 })
  })

  // No destination id means "email me", which Redash expresses as a
  // subscription with no destination. Sending `destination_id: null` is a
  // different request, so the key has to be absent.
  it('subscribes the caller by email when no destination is given', async () => {
    await subscribe(2)

    expect(post).toHaveBeenCalledWith('alerts/2/subscriptions', {})
  })

  it('treats an explicit null destination as the email subscription too', async () => {
    await subscribe(2, null)

    expect(post).toHaveBeenCalledWith('alerts/2/subscriptions', {})
  })

  // Destination id 0 is a real id, and `destinationId != null` is what keeps it
  // from falling into the email branch.
  it('keeps a destination id of zero', async () => {
    await subscribe(2, 0)

    expect(post).toHaveBeenCalledWith('alerts/2/subscriptions', { destination_id: 0 })
  })

  it('detaches by deleting the subscription, not the destination', async () => {
    await unsubscribe(2, 5)

    expect(del).toHaveBeenCalledWith('alerts/2/subscriptions/5')
  })
})
