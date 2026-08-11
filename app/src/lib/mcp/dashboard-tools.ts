// The tools that read dashboards.

import { callRedash, type McpCredential } from '@/lib/mcp/redash-caller'
import { requireString } from '@/lib/mcp/tool-args'
import { clampPageSize } from '@/lib/mcp/tool-schemas'
import type { Paginated, RedashDashboard } from '@/lib/mcp/redash-types'

// Dashboards are searched and slug-resolved by reading pages, not by Redash's
// `q`. That parameter is backed by a search index which a perfectly working
// instance can have empty: on the local stack it returns nothing for an exact
// dashboard name while query search works fine. Filtering here is a few more
// requests and gives the same answer on every instance.
const DASHBOARD_PAGE_SIZE = 100
const MAX_DASHBOARD_PAGES = 10

async function* dashboardPages(credential: McpCredential, signal?: AbortSignal) {
  for (let page = 1; page <= MAX_DASHBOARD_PAGES; page++) {
    const body = await callRedash<Paginated<RedashDashboard>>(
      `/api/dashboards?page=${page}&page_size=${DASHBOARD_PAGE_SIZE}`,
      credential,
      { signal }
    )
    const results = body.results ?? []
    yield results
    if (results.length < DASHBOARD_PAGE_SIZE) return
  }
}

export async function listDashboards(
  args: Record<string, unknown>,
  credential: McpCredential,
  signal?: AbortSignal
) {
  const limit = clampPageSize(args.page_size)
  const search = typeof args.search === 'string' ? args.search.trim().toLowerCase() : ''

  const matched: RedashDashboard[] = []
  let truncated = false
  for await (const page of dashboardPages(credential, signal)) {
    for (const dashboard of page) {
      if (search && !dashboard.name.toLowerCase().includes(search)) continue
      matched.push(dashboard)
    }
    if (matched.length >= limit) {
      truncated = true
      break
    }
  }

  return {
    count: matched.length,
    // Said rather than implied: a silently cut list reads as "that is all of
    // them", and a model would stop looking.
    ...(truncated ? { note: `Showing the first ${limit}. Raise page_size to see more.` } : {}),
    dashboards: matched.slice(0, limit).map((dashboard) => ({
      id: dashboard.id,
      name: dashboard.name,
      slug: dashboard.slug,
      updated_at: dashboard.updated_at,
    })),
  }
}

/**
 * Turn a slug into the numeric id the dashboard endpoint wants.
 *
 * This Redash version looks a dashboard up by primary key alone: handing it a
 * slug puts the string straight into `WHERE dashboards.id = 'regional-overview'`
 * and the request dies as a Postgres cast error behind an HTML 500. Slugs are
 * what list_dashboards returns and what a person reads off a URL, so they are
 * resolved here rather than being refused.
 */
async function resolveDashboardSlug(
  slug: string,
  credential: McpCredential,
  signal?: AbortSignal
): Promise<number> {
  for await (const page of dashboardPages(credential, signal)) {
    const match = page.find((dashboard) => dashboard.slug === slug || dashboard.name === slug)
    if (match) return match.id
  }
  throw new Error(`No dashboard with the id or slug "${slug}".`)
}

export async function getDashboard(
  args: Record<string, unknown>,
  credential: McpCredential,
  signal?: AbortSignal
) {
  const key = requireString(args, 'dashboard')
  const id = /^\d+$/.test(key) ? key : await resolveDashboardSlug(key, credential, signal)
  const dashboard = await callRedash<RedashDashboard>(`/api/dashboards/${id}`, credential, {
    signal,
  })
  return {
    id: dashboard.id,
    name: dashboard.name,
    slug: dashboard.slug,
    widgets: (dashboard.widgets ?? []).map((widget) => ({
      id: widget.id,
      text: widget.text || undefined,
      visualization: widget.visualization
        ? {
            name: widget.visualization.name,
            type: widget.visualization.type,
            query_id: widget.visualization.query?.id,
            query_name: widget.visualization.query?.name,
          }
        : undefined,
    })),
  }
}
