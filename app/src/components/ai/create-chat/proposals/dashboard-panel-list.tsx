'use client'

// The dashboard proposal's panel list. Extracted from the card once a panel
// could be a query that does not exist yet: a row now has a second state, and
// the SQL behind it has to be readable before anyone presses Create.
import { X } from 'lucide-react'
import { IconButton } from '@/components/shared/icon-button'
import { Badge } from '@/components/ui/badge'
import type { DashboardWidgetProposal } from '@/types/ai-create'
import { WrittenQueryDisclosure } from './written-query-disclosure'

interface QueryName {
  id: number
  name: string
}

interface DashboardPanelListProps {
  widgets: DashboardWidgetProposal[]
  /** The instance's queries, for naming the panels that point at one. */
  queries: QueryName[]
  busy: boolean
  onRemove: (index: number) => void
}

export function DashboardPanelList({
  widgets,
  queries,
  busy,
  onRemove,
}: DashboardPanelListProps) {
  if (widgets.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No panels left. Add one back by asking in the chat.
      </p>
    )
  }

  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {widgets.map((widget, index) => {
        const query = queries.find((item) => item.id === widget.queryId)
        return (
          <li
            key={widget.newQuery ? `new-${widget.title}-${index}` : `${widget.queryId}-${widget.visualizationId}`}
            className="flex items-start justify-between gap-3 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm">{widget.title}</p>
                {widget.newQuery && (
                  // Said plainly, because pressing Create writes this query
                  // into the instance as well as building the dashboard.
                  <Badge variant="secondary" className="shrink-0">
                    New query
                  </Badge>
                )}
              </div>
              {widget.newQuery ? (
                <WrittenQueryDisclosure newQuery={widget.newQuery} label={widget.title} />
              ) : (
                <p className="truncate text-xs text-muted-foreground">
                  {query?.name ?? `Query #${widget.queryId}`}
                </p>
              )}
            </div>
            <IconButton
              tooltip="Remove panel from this dashboard"
              aria-label={`Remove ${widget.title}`}
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              onClick={() => onRemove(index)}
            >
              <X aria-hidden="true" />
            </IconButton>
          </li>
        )
      })}
    </ul>
  )
}
