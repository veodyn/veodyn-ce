// Creating a dashboard that is listed for the whole org from the moment it
// exists.
//
// DashboardListResource.post in node/redash/handlers/dashboards.py creates
// every dashboard with is_draft=True and reads nothing but the name, and
// Dashboard.all shows a draft to its owner alone, admins included. This client
// has no publish control, so create() must follow up with the un-draft update
// itself or every dashboard made through the app stays private forever.
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import * as dashboardsService from '@/services/redash/dashboards'

const NEW_ID = 4243

const BASE = {
  id: NEW_ID,
  name: 'New Dashboard',
  slug: 'new-dashboard',
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
    http.post('/api/node/dashboards', async ({ request }) => {
      created.push(await request.json())
      // What Redash actually returns: a draft, no matter what was sent.
      return HttpResponse.json({ ...BASE, is_draft: true })
    }),
    http.post(`/api/node/dashboards/${NEW_ID}`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      updated.push(body)
      return HttpResponse.json({ ...BASE, ...body })
    })
  )
  return { created, updated }
}

describe('dashboardsService.create', () => {
  it('follows the create with the update Redash needs to un-draft it', async () => {
    const { created, updated } = serveCreate()

    const dashboard = await dashboardsService.create({ name: 'New Dashboard' })

    expect(created).toEqual([{ name: 'New Dashboard' }])
    expect(updated).toEqual([{ is_draft: false }])
    // The returned row is the published one, not the draft the create
    // endpoint handed back.
    expect(dashboard.is_draft).toBe(false)
    expect(dashboard.id).toBe(NEW_ID)
  })
})
