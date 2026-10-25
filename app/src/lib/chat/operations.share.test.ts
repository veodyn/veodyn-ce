import { describe, expect, it } from 'vitest'
import {
  favorite,
  OWNER,
  OWNER_SESSION,
  rawDashboard,
  rawQuery,
  readsOf,
  sessionOf,
  shareChart,
  shareDashboard,
  STRANGER,
  STRANGER_SESSION,
} from './operation-fixtures'
import { onlyOwnerMay, resolveOperation, UNSAFE_QUERY } from './operations'

const signal = new AbortController().signal

describe('resolveOperation: favorite', () => {
  it('favorites a readable dashboard and unfavorites a query', async () => {
    const add = await resolveOperation(
      favorite('dashboard', 3),
      readsOf({ session: STRANGER_SESSION, 'dashboards/3': rawDashboard() }),
      signal
    )
    const remove = await resolveOperation(
      favorite('query', 7, false),
      readsOf({ session: STRANGER_SESSION, 'queries/7': rawQuery({ is_favorite: true }) }),
      signal
    )
    expect(add).toMatchObject({ ok: true, op: 'favorite', target: { kind: 'dashboard', id: 3 }, destructive: false })
    expect(remove).toMatchObject({ ok: true, op: 'unfavorite', target: { kind: 'query', id: 7 }, problems: [] })
  })

  it('says when it is already in that state', async () => {
    const result = await resolveOperation(
      favorite('query', 7),
      readsOf({ session: STRANGER_SESSION, 'queries/7': rawQuery({ is_favorite: true }) }),
      signal
    )
    expect(result).toMatchObject({ problems: [expect.stringContaining('already')] })
  })
})

describe('resolveOperation: share a dashboard', () => {
  it('lets the owner with publish_dashboard create a link, echoing the expiry', async () => {
    const later = '2026-12-01T00:00:00Z'
    const result = await resolveOperation(
      shareDashboard('create', later),
      readsOf({ session: OWNER_SESSION, 'dashboards/3': rawDashboard() }),
      signal
    )
    expect(result).toMatchObject({
      ok: true,
      op: 'share',
      target: { kind: 'dashboard', id: 3, name: 'Ops' },
      params: { expiresAt: later },
      destructive: false,
      problems: [],
    })
    expect((result as { params: Record<string, unknown> }).params.refreshSeconds).toBeUndefined()
  })

  it('refuses the owner without publish_dashboard and a publisher who is not the owner', async () => {
    const unpermitted = await resolveOperation(
      shareDashboard('create'),
      readsOf({ session: sessionOf(OWNER, []), 'dashboards/3': rawDashboard() }),
      signal
    )
    const notOwner = await resolveOperation(
      shareDashboard('create'),
      readsOf({ session: STRANGER_SESSION, 'dashboards/3': rawDashboard() }),
      signal
    )
    expect(unpermitted).toMatchObject({ problems: [expect.stringContaining('publish_dashboard')] })
    expect(notOwner).toMatchObject({ problems: [onlyOwnerMay('dashboard', 'share')] })
  })

  it('revokes a live link as a destructive operation, and refuses when there is none', async () => {
    const live = await resolveOperation(
      shareDashboard('revoke'),
      readsOf({ session: OWNER_SESSION, 'dashboards/3': rawDashboard({ api_key: 'tok' }) }),
      signal
    )
    const none = await resolveOperation(
      shareDashboard('revoke'),
      readsOf({ session: OWNER_SESSION, 'dashboards/3': rawDashboard() }),
      signal
    )
    expect(live).toMatchObject({ ok: true, op: 'revoke', destructive: true, problems: [] })
    expect(none).toMatchObject({ problems: [expect.stringContaining('no public link')] })
  })
})

describe('resolveOperation: share a chart', () => {
  it('publishes a chart of a safe query with the refresh cadence the request named', async () => {
    const result = await resolveOperation(
      shareChart('create', 60),
      readsOf({ session: OWNER_SESSION, 'queries/7': rawQuery() }),
      signal
    )
    expect(result).toMatchObject({
      ok: true,
      op: 'share',
      target: { kind: 'visualization', id: 31, name: 'Revenue by week', queryId: 7 },
      params: { expiresAt: null, refreshSeconds: 60, queryName: 'Weekly revenue' },
      destructive: false,
      problems: [],
    })
  })

  it('refuses a query with text parameters', async () => {
    const result = await resolveOperation(
      shareChart('create'),
      readsOf({ session: OWNER_SESSION, 'queries/7': rawQuery({ is_safe: false }) }),
      signal
    )
    expect(result).toMatchObject({ problems: [UNSAFE_QUERY] })
  })

  it('refuses without publish_visualization, for a non-owner, and for a chart the query does not have', async () => {
    const unpermitted = await resolveOperation(
      shareChart('create'),
      readsOf({ session: sessionOf(OWNER, ['edit_query']), 'queries/7': rawQuery() }),
      signal
    )
    const notOwner = await resolveOperation(
      shareChart('create'),
      readsOf({ session: sessionOf(STRANGER, ['publish_visualization']), 'queries/7': rawQuery() }),
      signal
    )
    const missing = await resolveOperation(
      { ...shareChart('create'), args: { ...shareChart('create').args, visualizationId: 99 } },
      readsOf({ session: OWNER_SESSION, 'queries/7': rawQuery() }),
      signal
    )
    expect(unpermitted).toMatchObject({ problems: [expect.stringContaining('publish_visualization')] })
    expect(notOwner).toMatchObject({ problems: [onlyOwnerMay('query', 'share')] })
    expect(missing).toMatchObject({ ok: false })
  })

  it('revokes a chart link destructively, only when it has one', async () => {
    const withLink = rawQuery({
      visualizations: [{ id: 31, type: 'CHART', name: 'Revenue by week', options: {}, api_key: 'tok' }],
    })
    const live = await resolveOperation(
      shareChart('revoke'),
      readsOf({ session: OWNER_SESSION, 'queries/7': withLink }),
      signal
    )
    const none = await resolveOperation(
      shareChart('revoke'),
      readsOf({ session: OWNER_SESSION, 'queries/7': rawQuery() }),
      signal
    )
    expect(live).toMatchObject({ ok: true, op: 'revoke', destructive: true, problems: [] })
    expect(none).toMatchObject({ problems: [expect.stringContaining('no public link')] })
  })
})
