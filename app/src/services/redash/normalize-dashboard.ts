import type { MockDashboard, MockDashboardWidget } from '@/lib/mock-data'
import type { RedashDashboard, RedashWidget } from './types'

export function normalizeWidget(
  raw: RedashWidget,
  dashboardId: number
): MockDashboardWidget {
  const viz = raw.visualization
  return {
    id: raw.id,
    dashboard_id: raw.dashboard_id ?? dashboardId,
    visualization: viz
      ? {
          id: viz.id,
          type: viz.type,
          name: viz.name,
          description: viz.description ?? '',
          options: viz.options ?? {},
          query: {
            id: viz.query?.id ?? 0,
            name: viz.query?.name,
            // Carried through, not dropped: this normalizer rebuilds the query
            // ref field by field, so anything it does not name is gone by the
            // time a widget sees it. The owner is what gates the widget's own
            // edit control, and without this line that control was invisible in
            // real mode for everyone except an admin, including the person who
            // owns the query.
            user: viz.query?.user,
            data_source_id: viz.query?.data_source_id,
            // Same failure mode as the owner above. serialize_query sends
            // `options`, which is where the parameter definitions live, and
            // without them the dashboard can neither draw a control for its own
            // parameters nor tell a widget what its query requires. The backend
            // refuses a parameterised query run with nothing supplied rather
            // than falling back to the saved defaults.
            options: viz.query?.options as NonNullable<
              MockDashboardWidget['visualization']
            >['query']['options'],
            latest_query_data_id: viz.query?.latest_query_data_id ?? null,
            latest_query_data: (viz.query?.latest_query_data ?? null) as NonNullable<
              MockDashboardWidget['visualization']
            >['query']['latest_query_data'],
          },
        }
      : undefined,
    text: raw.text || undefined,
    width: raw.width ?? 1,
    updated_at: raw.updated_at,
    options: {
      ...raw.options,
      position: raw.options?.position ?? { col: 0, row: 0, sizeX: 3, sizeY: 8 },
      parameterMappings: raw.options?.parameterMappings,
      isHidden: raw.options?.isHidden,
    },
  }
}

export function normalizeDashboard(raw: RedashDashboard): MockDashboard {
  return {
    id: raw.id,
    name: raw.name,
    slug: raw.slug ?? String(raw.id),
    tags: raw.tags ?? [],
    is_archived: raw.is_archived ?? false,
    is_draft: raw.is_draft ?? false,
    is_favorite: raw.is_favorite ?? false,
    can_edit: raw.can_edit ?? false,
    user: raw.user ?? { id: raw.user_id ?? 0, name: '', email: '' },
    widgets: (raw.widgets ?? []).map((w) => normalizeWidget(w, raw.id)),
    dashboard_filters_enabled: raw.dashboard_filters_enabled ?? false,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    public_url: raw.public_url ?? null,
    api_key: raw.api_key ?? null,
    version: raw.version,
  }
}
