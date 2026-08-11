// Creating a query that is shared from the moment it exists.
//
// QueryListResource.post in node/redash/handlers/queries.py sets
// query_def["is_draft"] = True after reading the body, unconditionally, so the
// field in the create payload is ignored. A caller that wants the query listed
// therefore has to say so a second time. This is the test that would have
// caught "send is_draft: false in the create body and call it done", which
// looks right, passes in mock mode, and does nothing at all against Redash.
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import * as queriesService from '@/services/redash/queries'

const NEW_ID = 4242

const BASE = {
  id: NEW_ID,
  name: 'New Query',
  query: 'select 1',
  data_source_id: 1,
  user: { id: 1, name: 'A', email: 'a@example.com' },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  version: 1,
}

/** Serves create and update, recording every body either one receives. */
function serveCreate() {
  const created: unknown[] = []
  const updated: unknown[] = []
  server.use(
    http.post('/api/node/queries', async ({ request }) => {
      created.push(await request.json())
      // What Redash actually returns: a draft, whatever the body asked for.
      return HttpResponse.json({ ...BASE, is_draft: true })
    }),
    http.post(`/api/node/queries/${NEW_ID}`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      updated.push(body)
      return HttpResponse.json({ ...BASE, ...body })
    })
  )
  return { created, updated }
}

describe('queriesService.create', () => {
  it('follows the create with the update Redash needs to un-draft it', async () => {
    const { created, updated } = serveCreate()

    const query = await queriesService.create({ query: 'select 1', is_draft: false })

    expect(created).toHaveLength(1)
    expect(updated).toEqual([{ is_draft: false }])
    // The returned row is the one the caller asked for, not the draft the
    // create endpoint handed back.
    expect(query.is_draft).toBe(false)
    expect(query.id).toBe(NEW_ID)
  })

  it('sends no second request when the caller wants a draft', async () => {
    const { created, updated } = serveCreate()

    const query = await queriesService.create({ query: 'select 1' })

    expect(created).toHaveLength(1)
    expect(updated).toEqual([])
    expect(query.is_draft).toBe(true)
  })
})
