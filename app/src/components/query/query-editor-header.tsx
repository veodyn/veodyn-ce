'use client'

import { useUpdateQuery } from '@/hooks/use-queries'
import { useTagVocabulary } from '@/hooks/use-tag-vocabulary'
import { useOptimisticTags } from '@/hooks/use-optimistic-tags'
import { useConfig } from '@/components/config/config-provider'
import { EditInPlace } from '@/components/shared/edit-in-place'
import { TagsControl } from '@/components/shared/tags-control'
import { FavoritesControl } from '@/components/shared/favorites-control'
import { useAuthStore } from '@/stores/auth-store'
import { QuerySourceMenu } from './query-source-menu'
import { QueryDraftBadge } from './query-draft-badge'
import type { MockQuery } from '@/lib/mock-data'
import { SECTION_HEADING } from '@/lib/section-heading'

interface QueryEditorHeaderProps {
  existingQuery: MockQuery | null | undefined
  isDirty: boolean
  queryId?: number
  onOpenSchedule: () => void
  onOpenApiKey: () => void
  onOpenAddToDashboard: () => void
  onOpenPermissions: () => void
}

export function QueryEditorHeader({
  existingQuery,
  isDirty,
  queryId,
  onOpenSchedule,
  onOpenApiKey,
  onOpenAddToDashboard,
  onOpenPermissions,
}: QueryEditorHeaderProps) {
  const updateQuery = useUpdateQuery()
  const draftsEnabled = useConfig().features.query_drafts
  const currentUser = useAuthStore((s) => s.currentUser)
  // Always an array and never rejecting, so the vocabulary being down degrades
  // the add input to free text rather than taking tagging out.
  const tagSuggestions = useTagVocabulary().data
  // The array arrives whole from TagsControl, `domain:*` included, so a save
  // built from it cannot drop a domain hub.
  const saveTags = useOptimisticTags(['query', queryId], (tags, options) => {
    if (queryId) updateQuery.mutate({ id: queryId, tags }, options)
  })

  // The same rule the query detail page applies, so the two surfaces agree
  // about who may tag. An unsaved query has no id to write to, so its tags stay
  // read-only rather than offering an add that would go nowhere.
  const canEdit = Boolean((existingQuery?.can_edit || currentUser?.isAdmin) && queryId)

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b bg-card">
      <div className="flex items-center gap-3">
        {/* The page's primary heading. The title stays editable in place; the
            h1 gives the editor a semantic heading it otherwise lacked. */}
        <h1 className="font-display text-lg font-medium m-0">
          <EditInPlace
            value={existingQuery?.name ?? 'New Query'}
            onSave={(name) => {
              if (queryId) updateQuery.mutate({ id: queryId, name })
            }}
            className={SECTION_HEADING}
          />
        </h1>
        {/* Beside the title, because the only signal that a query was still a
            draft used to be which word the overflow menu happened to show, and
            you had to open the menu to find out. Gone with the draft workflow
            off, where every saved query is already shared and a badge saying
            otherwise would name a state nothing can produce. */}
        {draftsEnabled && existingQuery?.is_draft && <QueryDraftBadge />}
        {/* The list pages carry a star per row, but this is where you are when
            you decide a query is worth keeping, and until now the only way to
            favorite it was to navigate back to the list. */}
        {existingQuery && queryId && (
          <FavoritesControl
            type="queries"
            id={queryId}
            isFavorite={existingQuery.is_favorite ?? false}
          />
        )}
        {isDirty && <span className="text-sm text-destructive">*</span>}
        {existingQuery?.tags && (
          <TagsControl
            tags={existingQuery.tags}
            editable={canEdit}
            onChange={saveTags}
            suggestions={tagSuggestions}
          />
        )}
      </div>
      <div className="flex items-center gap-2">
        {existingQuery && (
          <QuerySourceMenu
            query={existingQuery}
            onOpenSchedule={onOpenSchedule}
            onOpenApiKey={onOpenApiKey}
            onOpenAddToDashboard={onOpenAddToDashboard}
            onOpenPermissions={onOpenPermissions}
          />
        )}
      </div>
    </div>
  )
}
