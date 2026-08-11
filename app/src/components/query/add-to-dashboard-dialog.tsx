'use client'

import { useId, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/components/shared/toast-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCreateDashboard, useDashboards } from '@/hooks/use-dashboards'
import { useCreateWidget } from '@/hooks/use-widgets'
import { TimeAgo } from '@/components/shared/time-ago'
import type { MockDashboard, MockDashboardWidget, MockVisualization } from '@/lib/mock-data'

interface AddToDashboardDialogProps {
  open: boolean
  onClose: () => void
  queryId: number
  visualizations: MockVisualization[]
}

// The dashboard a widget is being placed on, as little of it as the placement
// needs. `widgets` is optional on purpose: the list payload omits the array and
// a freshly created dashboard has nothing in it, and neither case should throw.
type PlacementTarget = { id: number; widgets?: MockDashboardWidget[] }

function failureText(err: unknown): string {
  return err instanceof Error ? err.message : 'Please try again.'
}

export function AddToDashboardDialog({ open, onClose, queryId, visualizations }: AddToDashboardDialogProps) {
  const [search, setSearch] = useState('')
  const [selectedVizId, setSelectedVizId] = useState(visualizations[0]?.id)
  // null means "not creating". A string, empty included, means the inline form
  // is open, so an emptied name does not silently drop back to the list.
  const [newName, setNewName] = useState<string | null>(null)
  const { data: dashboardsData } = useDashboards()
  const createDashboard = useCreateDashboard()
  const createWidget = useCreateWidget()
  const toast = useToast()
  const nameId = useId()
  const vizId = useId()

  const dashboards = (dashboardsData?.results ?? []).filter(
    (d) => !d.is_archived && (search ? d.name.toLowerCase().includes(search.toLowerCase()) : true)
  )
  const viz = visualizations.find((v) => v.id === selectedVizId) ?? visualizations[0]
  const busy = createDashboard.isPending || createWidget.isPending

  // Every way out of the dialog goes through here, because this component stays
  // mounted once it closes: the dialog primitive unmounts its content, but the
  // state above survives on this component instance. Without the reset,
  // creating "Q3 metrics" and reopening the dialog on the next query lands back
  // on the create form with that name still in it, one click away from a second
  // dashboard of the same name.
  const close = () => {
    setNewName(null)
    onClose()
  }

  const widgetFor = (dashboard: PlacementTarget, visualization: MockVisualization) => {
    const maxRow = (dashboard.widgets ?? []).reduce(
      (max, w) => Math.max(max, w.options.position.row + w.options.position.sizeY),
      0
    )
    return {
      dashboardId: dashboard.id,
      visualization: {
        id: visualization.id,
        query: { id: queryId },
        type: visualization.type,
        name: visualization.name,
        description: visualization.description,
        options: visualization.options as Record<string, unknown>,
      },
      width: 1,
      options: { position: { col: 0, row: maxRow, sizeX: 3, sizeY: 6 } },
    }
  }

  const handleAdd = (dashboardId: number) => {
    const dashboard = dashboards.find((d) => d.id === dashboardId)
    if (!dashboard || !viz) return
    createWidget.mutate(widgetFor(dashboard, viz))
    close()
  }

  const handleCreate = async () => {
    const name = newName?.trim()
    if (!name || !viz) return

    let dashboard: MockDashboard
    try {
      dashboard = await createDashboard.mutateAsync({ name })
    } catch (err) {
      // Still on the form, with the name the user typed: the dashboard does not
      // exist, so the only way forward is to try the same create again.
      toast.error(`Could not create "${name}". ${failureText(err)}`)
      return
    }

    try {
      // Placement comes off the dashboard that was just created, not off any
      // row in the list: the list is a page of summaries that does not contain
      // it yet.
      await createWidget.mutateAsync(widgetFor(dashboard, viz))
    } catch (err) {
      // Half-done, and closing here would look like it worked. Back to the
      // list rather than the form, because the dashboard now exists and
      // confirming the form again would create a second one with the same name.
      toast.error(`Created "${name}", but ${viz.name} was not added to it. ${failureText(err)}`)
      setNewName(null)
      return
    }
    close()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close() }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Add to Dashboard</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-3 overflow-y-auto">
          {visualizations.length > 1 && (
            <div>
              <Label htmlFor={vizId} className="mb-1 block">Visualization</Label>
              <Select
                value={String(selectedVizId)}
                onValueChange={(v) => { if (v != null) setSelectedVizId(Number(v)) }}
              >
                <SelectTrigger id={vizId} className="w-full h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {visualizations.map((v) => (
                    <SelectItem key={v.id} value={String(v.id)}>{v.name} ({v.type})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {newName === null ? (
            <>
              <InputGroup>
                <InputGroupAddon>
                  <Search className="h-4 w-4" />
                </InputGroupAddon>
                <InputGroupInput
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search dashboards..."
                />
              </InputGroup>
              <div className="max-h-[300px] overflow-y-auto divide-y border rounded-md">
                {/* Above the results, not only in the empty state: the dashboard
                    someone wants to make can perfectly well share a word with
                    three that already exist. */}
                <Button
                  variant="ghost"
                  onClick={() => setNewName(search.trim())}
                  className="w-full h-auto justify-start rounded-none text-left px-4 py-3 hover:bg-muted/50"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span className="text-sm font-medium">Create new dashboard</span>
                </Button>
                {dashboards.map((d) => (
                  <Button
                    key={d.id}
                    variant="ghost"
                    onClick={() => handleAdd(d.id)}
                    className="w-full h-auto justify-start rounded-none text-left px-4 py-3 hover:bg-muted/50"
                  >
                    <div>
                      <div className="text-sm font-medium">{d.name}</div>
                      {/* Not a widget count. The dashboards list endpoint returns
                          summaries with no widgets array, and normalizeDashboard
                          turns that absence into [], so every row here read
                          "0 widgets" against a real backend whether or not the
                          dashboard had any. It only looked right in mock mode,
                          where the fixtures carry widgets inline. The payload has
                          no count field to use instead, and fetching every
                          dashboard's detail to label a picker is not worth it, so
                          this shows something the list does carry. */}
                      <div className="text-xs text-muted-foreground">
                        Updated <TimeAgo date={d.updated_at} />
                      </div>
                    </div>
                  </Button>
                ))}
                {dashboards.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground space-y-3">
                    <p>No dashboards found</p>
                    {search.trim() !== '' && (
                      <Button variant="outline" size="sm" onClick={() => setNewName(search.trim())}>
                        Create &quot;{search.trim()}&quot;
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-3 border rounded-md p-4">
              <div className="space-y-2">
                <Label htmlFor={nameId}>New dashboard name</Label>
                <Input
                  id={nameId}
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Dashboard name"
                  disabled={busy}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {viz
                  ? `${viz.name} will be added to it.`
                  : 'This query has no visualization to add.'}
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setNewName(null)} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  onClick={() => { void handleCreate() }}
                  disabled={busy || newName.trim() === '' || !viz}
                >
                  {busy ? 'Creating...' : 'Create and add'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
