/**
 * Query snippets against the real Redash backend.
 */

import { redashApi } from '@/services/api-client'
import type { MockQuerySnippet } from '@/lib/mock-data'

interface RedashSnippet {
  id: number
  trigger: string
  description: string
  snippet: string
  user?: { id: number; name: string }
  created_at: string
  updated_at: string
}

function normalizeSnippet(raw: RedashSnippet): MockQuerySnippet {
  return {
    id: raw.id,
    trigger: raw.trigger,
    description: raw.description ?? '',
    snippet: raw.snippet,
    user: raw.user ?? { id: 0, name: '' },
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  }
}

export async function list(): Promise<MockQuerySnippet[]> {
  const raw = await redashApi.get<RedashSnippet[]>('query_snippets')
  return raw.map(normalizeSnippet)
}

export async function create(data: {
  trigger: string
  description: string
  snippet: string
}): Promise<MockQuerySnippet> {
  return normalizeSnippet(await redashApi.post<RedashSnippet>('query_snippets', data))
}

export async function update(
  id: number,
  changes: { trigger?: string; description?: string; snippet?: string }
): Promise<MockQuerySnippet> {
  return normalizeSnippet(
    await redashApi.post<RedashSnippet>(`query_snippets/${id}`, changes)
  )
}

export async function remove(id: number): Promise<void> {
  await redashApi.delete(`query_snippets/${id}`)
}
