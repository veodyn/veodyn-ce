'use client'

// The dashboard proposal: a name and a list of panels. A panel is a query that
// already exists, or one the service wrote for a gap nothing filled, in which
// case Create writes the query first and then hangs it on the dashboard.
//
// Queries before the dashboard, deliberately: a query that fails to save is a
// panel that cannot exist, and finding that out after the dashboard is built
// leaves a hole in something already created and already navigated to.
import { useId, useState } from 'react'
import { useToast } from '@/components/shared/toast-provider'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCreateDashboard } from '@/hooks/use-dashboards'
import { useDataSources } from '@/hooks/use-data-sources'
import { useAllQueries } from '@/hooks/use-queries'
import { useCreateWidget } from '@/hooks/use-widgets'
import type { DashboardProposal } from '@/types/ai-create'
import { DashboardPanelList } from './dashboard-panel-list'
import { ProposalFrame } from './proposal-frame'
import {
  createErrorMessage,
  defaultDataSourceId,
  partialDashboardMessage,
  removeAt,
  widgetPosition,
} from './proposal-model'
import { useCreateFromProposal } from './use-create-from-proposal'
import { useWidgetQueries } from './use-widget-queries'

interface DashboardProposalCardProps {
  proposal: DashboardProposal
  onCreated: (href: string | null) => void
  onBusyChange: (busy: boolean) => void
}

export function DashboardProposalCard({
  proposal,
  onCreated,
  onBusyChange,
}: DashboardProposalCardProps) {
  const { data: queryList } = useAllQueries()
  const { data: dataSources } = useDataSources()
  const createDashboard = useCreateDashboard()
  const createWidget = useCreateWidget()
  const widgetQueries = useWidgetQueries()
  const toast = useToast()
  const commit = useCreateFromProposal({ onCreated, onBusyChange })

  const nameId = useId()
  const sourceId = useId()
  const [name, setName] = useState(proposal.name)
  const [widgets, setWidgets] = useState(proposal.widgets)
  // Null until overridden, so the default follows the data sources as they
  // load rather than freezing from an empty first render. Same rule the query
  // card follows.
  const [chosenSource, setChosenSource] = useState<number | null>(null)

  const queries = queryList?.results ?? []
  const sources = dataSources ?? []
  const dataSourceId = chosenSource ?? defaultDataSourceId(sources)
  const written = widgets.filter((widget) => widget.newQuery != null).length
  const error = createErrorMessage('dashboard', commit.error)

  function create() {
    if (written > 0 && dataSourceId == null) return
    commit.start(async () => {
      // Every panel as a pair of real ids, writing the queries that do not
      // exist yet. Before the dashboard, for the reason at the top of the file.
      const { resolved, failed } = await widgetQueries.materialize(widgets, dataSourceId ?? 0)

      const dashboard = await createDashboard.mutateAsync({ name: name.trim() })
      // Sequential rather than parallel: the positions are an ordered layout,
      // and one widget failing must not take the rest of them with it.
      for (const [index, widget] of resolved.entries()) {
        const query = queries.find((item) => item.id === widget.queryId)
        const visualization = query?.visualizations.find(
          (item) => item.id === widget.visualizationId
        )
        try {
          await createWidget.mutateAsync({
            dashboardId: dashboard.id,
            visualization: {
              id: widget.visualizationId,
              query: { id: widget.queryId, name: query?.name ?? widget.visualization?.queryName },
              type: visualization?.type ?? widget.visualization?.type ?? 'TABLE',
              name: visualization?.name ?? widget.visualization?.name ?? widget.title,
              description: visualization?.description ?? '',
              options: visualization?.options ?? widget.visualization?.options ?? {},
            },
            width: 1,
            options: { position: widgetPosition(index) },
          })
        } catch {
          failed.push(widget.title)
        }
      }
      // A partial dashboard is still worth opening, but it is never reported as
      // a whole one: the widgets that did not land are named (spec section 7).
      const partial = partialDashboardMessage(failed)
      if (partial != null) toast.warning(partial)
      return `/dashboards/${dashboard.id}`
    })
  }

  return (
    <ProposalFrame
      title="Create this dashboard"
      description={
        written > 0
          ? `It writes ${written} ${written === 1 ? 'query' : 'queries'} and builds the dashboard from them. Open a panel to read its SQL, and remove any you do not want.`
          : 'It assembles queries that already exist. Remove any panel you do not want before creating it.'
      }
      createLabel={
        written > 0
          ? `Create dashboard + ${written} ${written === 1 ? 'query' : 'queries'}`
          : 'Create dashboard'
      }
      busy={commit.busy}
      error={error}
      canCreate={name.trim() !== '' && (written === 0 || dataSourceId != null)}
      onCreate={create}
    >
      <div className="space-y-2">
        <Label htmlFor={nameId}>Dashboard name</Label>
        <Input
          id={nameId}
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={commit.busy}
        />
      </div>

      {/* Only when something is being written. A dashboard assembled from
          queries that exist takes its connection from each of them, so a picker
          there would be asking about a decision that is not being made. */}
      {written > 0 && (
        <div className="space-y-2">
          <Label htmlFor={sourceId}>Data source for the new queries</Label>
          <Select
            value={dataSourceId == null ? '' : String(dataSourceId)}
            items={sources.map((source) => ({ label: source.name, value: String(source.id) }))}
            onValueChange={(value) => {
              if (value != null) setChosenSource(Number(value))
            }}
            disabled={commit.busy}
          >
            <SelectTrigger id={sourceId} className="w-full">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {sources.map((source) => (
                <SelectItem key={source.id} value={String(source.id)}>
                  {source.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium">Panels</p>
        <DashboardPanelList
          widgets={widgets}
          queries={queries}
          busy={commit.busy}
          onRemove={(index) => setWidgets((prev) => removeAt(prev, index))}
        />
      </div>
    </ProposalFrame>
  )
}
