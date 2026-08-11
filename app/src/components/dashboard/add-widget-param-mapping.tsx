'use client'

import { ArrowLeft, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import type { MockQuery } from '@/lib/mock-data'
import type { MappingType, ParameterMapping } from './add-widget-dialog'

interface AddWidgetParamMappingProps {
  query: MockQuery
  parameterMappings: ParameterMapping[]
  existingDashboardParams: string[]
  onBack: () => void
  onUpdateMapping: (index: number, updates: Partial<ParameterMapping>) => void
}

export function AddWidgetParamMapping({
  query,
  parameterMappings,
  existingDashboardParams,
  onBack,
  onUpdateMapping,
}: AddWidgetParamMappingProps) {
  return (
    <div className="space-y-4">
      <Button variant="link" onClick={onBack} className="h-auto gap-1 p-0">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to visualization
      </Button>

      <div className="p-3 bg-muted/50 rounded-md">
        <p className="text-sm font-medium">{query.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          This query has {parameterMappings.length} parameter(s). Configure how they connect to the dashboard.
        </p>
      </div>

      <div className="border rounded-md overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-b bg-muted/50">
              <TableHead className="text-left px-3 py-2 text-xs font-mono font-medium text-muted-foreground">Parameter</TableHead>
              <TableHead className="text-left px-3 py-2 text-xs font-mono font-medium text-muted-foreground">Keyword</TableHead>
              <TableHead className="text-left px-3 py-2 text-xs font-mono font-medium text-muted-foreground">Source</TableHead>
              <TableHead className="text-left px-3 py-2 text-xs font-mono font-medium text-muted-foreground">Value / Map To</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {parameterMappings.map((mapping, idx) => (
              <TableRow key={mapping.name} className="hover:bg-muted/20">
                <TableCell className="px-3 py-2.5 font-medium">{mapping.title}</TableCell>
                <TableCell className="px-3 py-2.5">
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{`{{ ${mapping.name} }}`}</code>
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  {/* No-op on a null/cleared value: MappingType has no valid empty member, so
                      there is nothing sensible to write back (unlike mapTo below, where '' is
                      a valid, meaningful value). */}
                  <Select
                    value={mapping.type}
                    onValueChange={(v) => v && onUpdateMapping(idx, { type: v as MappingType })}
                  >
                    <SelectTrigger size="sm" className="h-7">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dashboard-add-new">New dashboard parameter</SelectItem>
                      <SelectItem value="dashboard-map-to-existing" disabled={existingDashboardParams.length === 0}>
                        Existing dashboard parameter
                      </SelectItem>
                      <SelectItem value="widget-level">Widget level</SelectItem>
                      <SelectItem value="static-value">Static value</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  {mapping.type === 'static-value' ? (
                    <Input
                      type="text"
                      value={String(mapping.value)}
                      onChange={(e) => onUpdateMapping(idx, { value: e.target.value })}
                      className="h-7 text-xs"
                      placeholder="Static value"
                    />
                  ) : mapping.type === 'dashboard-map-to-existing' ? (
                    <Select value={mapping.mapTo} onValueChange={(v) => onUpdateMapping(idx, { mapTo: v ?? '' })}>
                      <SelectTrigger size="sm" className="h-7">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {existingDashboardParams.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : mapping.type === 'dashboard-add-new' ? (
                    <Input
                      type="text"
                      value={mapping.mapTo}
                      onChange={(e) => onUpdateMapping(idx, { mapTo: e.target.value })}
                      className="h-7 text-xs"
                      placeholder="Parameter name"
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">Uses default: {String(mapping.value)}</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-start gap-2 p-3 bg-primary/10 rounded-md text-xs text-foreground">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <p>
          <strong>New dashboard parameter</strong> creates a filter at the top of the dashboard.
          <strong> Existing</strong> links to an already-created dashboard filter.
          <strong> Widget level</strong> keeps the parameter local to this widget.
          <strong> Static value</strong> fixes the value: users cannot change it.
        </p>
      </div>
    </div>
  )
}
