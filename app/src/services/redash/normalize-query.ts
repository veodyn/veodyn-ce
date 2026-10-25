import type { MockQuery, MockQueryParameter, MockVisualization } from '@/lib/mock-data'
import type { RedashQuery } from './types'

export function normalizeQuery(raw: RedashQuery): MockQuery {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description ?? '',
    query: raw.query,
    data_source_id: raw.data_source_id,
    schedule: (raw.schedule ?? null) as MockQuery['schedule'],
    tags: raw.tags ?? [],
    is_archived: raw.is_archived ?? false,
    is_draft: raw.is_draft ?? false,
    is_favorite: raw.is_favorite ?? false,
    is_safe: (raw as { is_safe?: boolean }).is_safe ?? true,
    can_edit: raw.can_edit ?? false,
    user: raw.user,
    last_modified_by: raw.last_modified_by ?? raw.user,
    visualizations: (raw.visualizations ?? []) as MockVisualization[],
    latest_query_data_id: raw.latest_query_data_id ?? null,
    options: {
      parameters: (raw.options?.parameters ?? []) as unknown as MockQueryParameter[],
    },
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    retrieved_at: raw.retrieved_at ?? '',
    runtime: raw.runtime ?? 0,
    version: raw.version,
    api_key: raw.api_key,
  }
}
