'use client'

import Link from 'next/link'
import { RefreshCw, ExternalLink, Trash2, Expand, MessageSquarePlus, Pencil } from 'lucide-react'
import { IconButton } from '@/components/shared/icon-button'
import { ANNOTATIONS_SUPPORTED } from '@/services/redash/annotations'
import { WidgetFreshness } from './widget-freshness'

// The control row in a widget's header: the data age, then the icon buttons.
// Split out of visualization-widget so that file is about resolving and drawing
// a visualization, while this one is about which controls a given reader gets.
// Every gate in the product's widget chrome is now visible in one place, which
// is what made the ungated "Open query" obvious once it sat beside its
// neighbours.

interface WidgetControlsProps {
  /** Milliseconds since epoch, ticked once a minute; null before mount. */
  now: number | null
  retrievedAt: string | undefined
  onRefresh: () => void
  refreshing: boolean
  onExpand: () => void
  onAnnotate: () => void
  /** May edit the visualization, and there is a result to edit against. */
  canEdit: boolean
  onEdit: () => void
  queryId: number
  /** No session behind this render: drop controls that lead into the app. */
  isPublic: boolean
  isEditing: boolean
  onRemove?: () => void
}

export function WidgetControls({
  now,
  retrievedAt,
  onRefresh,
  refreshing,
  onExpand,
  onAnnotate,
  canEdit,
  onEdit,
  queryId,
  isPublic,
  isEditing,
  onRemove,
}: WidgetControlsProps) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <WidgetFreshness queryId={queryId} retrievedAt={retrievedAt} now={now} />
      {/* Author attribution and view count mount here when that metadata lands
          (umbrella section 4). */}
      {/* Five icons in a row, four of which are only distinguishable by
          shape. They used to carry `title`, which the keyboard never
          reaches and which arrives about a second late; the tooltip is
          the same word delivered where it is useful. */}
      <IconButton
        tooltip="Refresh"
        variant="ghost"
        size="icon-sm"
        onClick={onRefresh}
        disabled={refreshing}
      >
        <RefreshCw className={`h-3.5 w-3.5 text-muted-foreground ${refreshing ? 'animate-spin' : ''}`} />
      </IconButton>
      <IconButton tooltip="Expand" variant="ghost" size="icon-sm" onClick={onExpand}>
        <Expand className="h-3.5 w-3.5 text-muted-foreground" />
      </IconButton>
      {/* Only where an annotation can actually be stored. Offered
          unconditionally, this opened a full dialog whose every write
          answered 405 in silence. See ANNOTATIONS_SUPPORTED. */}
      {ANNOTATIONS_SUPPORTED && !isPublic && (
        <IconButton tooltip="Annotate" variant="ghost" size="icon-sm" onClick={onAnnotate}>
          <MessageSquarePlus className="h-3.5 w-3.5 text-muted-foreground" />
        </IconButton>
      )}
      {/* Not gated on dashboard edit mode: this edits the visualization,
          which belongs to the query, not the dashboard's layout. It is
          gated on being allowed to edit that query at all, which the
          widget can answer without a fetch because Redash serializes the
          query (and its owner) inside the widget. Redash still enforces
          the real thing on save; the toast in the parent is what a refusal
          looks like. */}
      {canEdit && (
        <IconButton tooltip="Edit visualization" variant="ghost" size="icon-sm" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
        </IconButton>
      )}
      {/* Gated like its two neighbours, which were already conditional while
          this one was not. /queries/<id> is authenticated, and the audience for
          a public link is by definition people without accounts, so on a shared
          dashboard this was a control on every widget that only ever reached a
          sign-in page. */}
      {!isPublic && (
        <IconButton
          tooltip="Open query"
          variant="ghost"
          size="icon-sm"
          render={<Link href={`/queries/${queryId}`} />}
        >
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
        </IconButton>
      )}
      {isEditing && (
        <IconButton tooltip="Remove widget" variant="ghost" size="icon-sm" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </IconButton>
      )}
    </div>
  )
}
