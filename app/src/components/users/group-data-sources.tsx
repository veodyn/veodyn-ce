'use client'

import { Trash2, Database } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/shared/icon-button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// ---------------------------------------------------------------------------
// Data sources tab: the group's data source grants plus an admin-only
// selector to add another one. Extracted from group-detail.tsx to keep that
// file under the file-size seam; a thin presentational list over data the
// parent owns and refetches.
// ---------------------------------------------------------------------------

interface RedashGroupDataSource {
  id: number
  name: string
  type: string
  view_only: boolean
}

interface GroupDataSourcesProps {
  dataSources: RedashGroupDataSource[]
  availableDataSources: Array<{ id: number; name: string }>
  isAdmin: boolean
  onAddDataSource: (dsId: string) => void
  onRemoveDataSource: (dsId: number) => void
  onUpdatePermission: (dsId: number, viewOnly: boolean) => void
}

export function GroupDataSources({
  dataSources,
  availableDataSources,
  isAdmin,
  onAddDataSource,
  onRemoveDataSource,
  onUpdatePermission,
}: GroupDataSourcesProps) {
  return (
    <div className="space-y-3">
      {isAdmin && availableDataSources.length > 0 && (
        <Select
          value=""
          onValueChange={(v) => onAddDataSource(v ?? '')}
          items={availableDataSources.map((ds) => ({ label: ds.name, value: String(ds.id) }))}
        >
          <SelectTrigger className="w-[300px]">
            <SelectValue placeholder="Add data source..." />
          </SelectTrigger>
          <SelectContent>
            {availableDataSources.map((ds) => (
              <SelectItem key={ds.id} value={String(ds.id)}>
                {ds.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="space-y-1">
        {dataSources.map((ds) => (
          <div key={ds.id} className="flex items-center justify-between rounded-md border px-3 py-2">
            <span className="text-sm">{ds.name}</span>
            <div className="flex items-center gap-2">
              {isAdmin ? (
                <Select
                  value={ds.view_only ? 'view' : 'full'}
                  onValueChange={(v) => {
                    if (v != null) onUpdatePermission(ds.id, v === 'view')
                  }}
                  items={[
                    { label: 'Full Access', value: 'full' },
                    { label: 'View Only', value: 'view' },
                  ]}
                >
                  <SelectTrigger size="sm" className="w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full Access</SelectItem>
                    <SelectItem value="view">View Only</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant={ds.view_only ? 'secondary' : 'default'}>
                  {ds.view_only ? 'View Only' : 'Full Access'}
                </Badge>
              )}
              {isAdmin && (
                <IconButton
                  tooltip="Remove data source from group"
                  aria-label={`Remove ${ds.name} from group`}
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemoveDataSource(ds.id)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </IconButton>
              )}
            </div>
          </div>
        ))}
        {dataSources.length === 0 && (
          <div className="rounded-md border border-dashed py-8 text-center">
            <Database className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              No data sources assigned to this group.
            </p>
            {isAdmin && availableDataSources.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                Add one above to control access.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
