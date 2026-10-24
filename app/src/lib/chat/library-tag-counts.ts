import { mergeTagCounts, type TagSuggestion } from '@/lib/tags'
import type { ChatLibraryTagCount } from './tool-results'

export const TAG_COUNT_LIMIT = 25
const TAG_NAME_CHARS = 64

export interface LibraryTagGroups {
  query?: TagSuggestion[]
  dashboard?: TagSuggestion[]
}

export function tagCountsOf(groups: LibraryTagGroups): ChatLibraryTagCount[] {
  return (['dashboard', 'query'] as const).flatMap((kind) =>
    mergeTagCounts([groups[kind] ?? []])
      .slice(0, TAG_COUNT_LIMIT)
      .map((tag) => ({ kind, name: tag.name.slice(0, TAG_NAME_CHARS), count: tag.count }))
  )
}
