'use client'

// Applying a proposed widget list to a dashboard that already exists.
//
// The sibling card (dashboard-proposal.tsx) creates a new dashboard from the
// same proposal shape. This one reads it as an end state and shows the
// difference from what is really there, because the destructive half is the
// part a user has to see before pressing anything: "add two, remove one" is a
// sentence somebody can check, a list of six panels is one they have to diff
// by eye against the page behind the dialog.
import { useToast } from '@/components/shared/toast-provider'
import { useDashboard } from '@/hooks/use-dashboards'
import { useCreateWidget, useDeleteWidget } from '@/hooks/use-widgets'
import { useDataSources } from '@/hooks/use-data-sources'
import { useAllQueries } from '@/hooks/use-queries'
import { resolveVizChoice } from '@/lib/viz-choices'
import type { DashboardProposal } from '@/types/ai-create'
import { ProposalFrame } from './proposal-frame'
import { createErrorMessage, defaultDataSourceId, widgetPosition } from './proposal-model'
import {
  dashboardEdit,
  editSummary,
  isNoChange,
  partialEditMessage,
  type ExistingWidget,
} from './dashboard-edit-model'
import { useCreateFromProposal } from './use-create-from-proposal'
import { useWidgetQueries } from './use-widget-queries'
import { useWidgetRedraw } from './use-widget-redraw'

// The proposal grid, moved down past whatever is staying. widgetPosition lays
// additions out two to a row from zero, which is right for a blank dashboard
// and an overlap on one that already has content.
function shiftBelow(
  position: { col: number; row: number; sizeX: number; sizeY: number },
  firstFreeRow: number
) {
  return { ...position, row: position.row + firstFreeRow }
}

interface DashboardEditProposalCardProps {
  proposal: DashboardProposal
  dashboardId: number
  onCreated: (href: string | null) => void
  onBusyChange: (busy: boolean) => void
}

export function DashboardEditProposalCard({
  proposal,
  dashboardId,
  onCreated,
  onBusyChange,
}: DashboardEditProposalCardProps) {
  const { data: dashboard } = useDashboard(dashboardId)
  // Whether the dashboard has actually been read, not whether it happens to
  // hold anything. Until it has, `current` is empty, so every proposed widget
  // reads as an addition and nothing reads as a removal: applying in that
  // window duplicates the panels already there, and a proposal that means
  // "remove the rest" does the exact opposite of what the card is about to
  // show. `undefined` is loading; `null` is a dashboard that is not there.
  const loaded = dashboard !== undefined
  const { data: queryList } = useAllQueries()
  const { data: dataSources } = useDataSources()
  const createWidget = useCreateWidget()
  const deleteWidget = useDeleteWidget()
  const widgetQueries = useWidgetQueries()
  const redraw = useWidgetRedraw()
  const toast = useToast()
  const commit = useCreateFromProposal({ onCreated, onBusyChange })

  const queries = queryList?.results ?? []
  // The connection any query written for an added panel is saved against. Not
  // offered as a choice here the way the create card offers it: an edit is one
  // click on a dashboard that already exists, and the default is the same
  // ClickHouse-first rule every other write uses.
  const dataSourceId = defaultDataSourceId(dataSources ?? [])
  const error = createErrorMessage('dashboard', commit.error)

  // Read off the dashboard itself, never off the proposal: the ids that get
  // deleted have to come from the half that knows what is really there.
  const current: ExistingWidget[] = (dashboard?.widgets ?? []).map((widget) => ({
    id: widget.id,
    queryId: widget.visualization?.query?.id ?? null,
    // What the panel draws today. Dropping it is what made a proposal that
    // changed every chart type read as "No change to this dashboard".
    visualizationId: widget.visualization?.id ?? null,
    title: widget.visualization?.query?.name ?? widget.text ?? `Widget #${widget.id}`,
  }))
  const edit = dashboardEdit(current, proposal.widgets)
  const nothingToDo = isNoChange(edit)

  function apply() {
    commit.start(async () => {
      const failed: string[] = []
      // Removals first, so a run that fails part way through has already made
      // the room the additions were sized against.
      const stillThere = new Set((dashboard?.widgets ?? []).map((widget) => widget.id))
      for (const widget of edit.remove) {
        try {
          await deleteWidget.mutateAsync({ dashboardId, widgetId: widget.id })
          stillThere.delete(widget.id)
        } catch {
          failed.push(widget.title)
        }
      }
      // Redraws. Redash cannot repoint a widget at another visualization, so
      // each is the old panel deleted and a new one created IN THE SAME PLACE:
      // a redrawn panel that reappeared at the bottom would read as the
      // dashboard having been rearranged behind the analyst's back.
      //
      // The visualization is resolved BEFORE the delete. A fork or a create
      // that fails then costs nothing, where doing it the other way round
      // leaves a hole on the dashboard where the widget used to be.
      for (const { widget, proposal } of edit.change) {
        const query = queries.find((item) => item.id === proposal.queryId)
        const panel = (dashboard?.widgets ?? []).find((one) => one.id === widget.id)
        if (query === undefined || panel === undefined) {
          failed.push(widget.title)
          continue
        }
        try {
          const drawn = await redraw.redraw(proposal, query)
          // The replacement is created BEFORE the original is deleted, and the
          // order is the whole safety of this loop. Deleting first means a
          // refused create leaves a hole where the analyst's widget used to be,
          // and nothing here can put it back. This way the worst case is two
          // panels stacked in one place: visible, and one click to tidy.
          const created = await createWidget.mutateAsync({
            dashboardId,
            visualization: {
              id: drawn.visualizationId,
              query: { id: drawn.queryId, name: drawn.queryName },
              type: drawn.type,
              name: drawn.name,
              description: '',
              options: drawn.options,
            },
            width: panel.width ?? 1,
            // The original's WHOLE options object, not just its position. A
            // widget also carries `parameterMappings`, which is how a dashboard
            // filter reaches it, and `isHidden`. Copying the position alone
            // silently unhooks the panel from the dashboard's filters and makes
            // a hidden one visible, neither of which is a redraw.
            options: { ...panel.options, position: panel.options.position },
          })
          try {
            await deleteWidget.mutateAsync({ dashboardId, widgetId: widget.id })
          } catch (removal) {
            // The original would not go, so the dashboard now has both panels
            // stacked in one place. Take the replacement back out rather than
            // leaving that: the grid compacts overlapping widgets and saves
            // where it moved them, so a duplicate left here does not stay a
            // tidy duplicate, it rearranges the dashboard.
            await deleteWidget
              .mutateAsync({ dashboardId, widgetId: created.id })
              .catch(() => undefined)
            throw removal
          }
          if (drawn.forkedFrom != null) {
            toast.info(
              `"${query.name}" is not yours, so the new chart went on a copy of it. The widget now reads the copy.`
            )
          }
        } catch {
          failed.push(widget.title)
        }
      }
      // Below everything that survives, measured off the real layout rather
      // than counted. Positions are absolute and widgets are not a uniform
      // size, so numbering additions from an index drops them on top of the
      // ones already on the dashboard.
      //
      // A redrawn widget's id stays in `stillThere` on purpose: its panel was
      // replaced, not removed, and the replacement occupies exactly the rows
      // the original did. Dropping it would let an addition land on top of it.
      //
      // Read AFTER the removals ran, from the ones that actually went. A
      // widget whose delete was refused is still on the dashboard, and sizing
      // the additions against the removals that were merely INTENDED drops a
      // new panel on top of it.
      const survivingRows = (dashboard?.widgets ?? [])
        .filter((widget) => stillThere.has(widget.id))
        .map((widget) => widget.options.position.row + widget.options.position.sizeY)
      const firstFreeRow = survivingRows.length === 0 ? 0 : Math.max(...survivingRows)
      // The additions as real ids, writing any query the proposal carries
      // rather than pointing at one. Before the widgets, the same order the
      // create card uses and for the same reason.
      const { resolved, failed: unwritable } = await widgetQueries.materialize(
        edit.add,
        dataSourceId ?? 0
      )
      failed.push(...unwritable)
      for (const [index, widget] of resolved.entries()) {
        const query = queries.find((item) => item.id === widget.queryId)
        const visualization = query?.visualizations.find(
          (item) => item.id === widget.visualizationId
        )
        try {
          await createWidget.mutateAsync({
            dashboardId,
            visualization: {
              id: widget.visualizationId,
              query: { id: widget.queryId, name: query?.name ?? widget.visualization?.queryName },
              type: visualization?.type ?? widget.visualization?.type ?? 'TABLE',
              name: visualization?.name ?? widget.visualization?.name ?? widget.title,
              description: visualization?.description ?? '',
              options: visualization?.options ?? widget.visualization?.options ?? {},
            },
            width: 1,
            options: { position: shiftBelow(widgetPosition(index), firstFreeRow) },
          })
        } catch {
          failed.push(widget.title)
        }
      }
      // Named, never swallowed: a partly applied edit that reports success is
      // how someone comes back to a dashboard missing a panel they were told
      // had landed.
      const partial = partialEditMessage(failed)
      if (partial != null) toast.warning(partial)
      // Null: the user is already on this dashboard, and navigating away from
      // the thing they just changed is not a reward for changing it.
      return null
    })
  }

  return (
    <ProposalFrame
      title="Apply this change"
      description={editSummary(edit)}
      createLabel="Apply change"
      busy={commit.busy}
      error={error}
      canCreate={loaded && !nothingToDo}
      onCreate={apply}
    >
      {edit.add.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Adding</p>
          <ul className="divide-y divide-border rounded-md border border-border">
            {edit.add.map((widget) => (
              <li key={`${widget.queryId}-${widget.visualizationId}`} className="px-3 py-2">
                <p className="truncate text-sm">{widget.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {queries.find((item) => item.id === widget.queryId)?.name ??
                    `Query #${widget.queryId}`}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {edit.change.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Redrawing</p>
          <ul className="divide-y divide-border rounded-md border border-border">
            {edit.change.map(({ widget, proposal }) => (
              <li key={widget.id} className="px-3 py-2">
                <p className="truncate text-sm">{widget.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  as {resolveVizChoice(proposal.vizChoiceId ?? '').label.toLowerCase()}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {edit.remove.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-destructive">Removing</p>
          <ul className="divide-y divide-border rounded-md border border-destructive/40">
            {edit.remove.map((widget) => (
              <li key={widget.id} className="px-3 py-2">
                <p className="truncate text-sm">{widget.title}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!loaded && (
        <p className="text-sm text-muted-foreground">Reading what this dashboard holds…</p>
      )}

      {loaded && nothingToDo && (
        <p className="text-sm text-muted-foreground">
          What was proposed is what the dashboard already holds. Ask for something else in the chat.
        </p>
      )}
    </ProposalFrame>
  )
}
