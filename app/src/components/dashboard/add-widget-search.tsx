'use client'

import { AlertTriangle, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import type { MockQuery } from '@/lib/mock-data'

interface AddWidgetSearchProps {
  search: string
  onSearchChange: (value: string) => void
  queries: MockQuery[]
  onSelectQuery: (queryId: number) => void
}

export function AddWidgetSearch({ search, onSearchChange, queries, onSelectQuery }: AddWidgetSearchProps) {
  return (
    <div className="space-y-3">
      <InputGroup>
        <InputGroupAddon>
          <Search className="h-4 w-4" />
        </InputGroupAddon>
        <InputGroupInput
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search queries by name..."
          autoFocus
        />
      </InputGroup>
      <div className="max-h-[380px] overflow-y-auto border rounded-md divide-y">
        {queries.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            {search ? 'No queries match your search' : 'No queries available'}
          </div>
        )}
        {queries.map((q) => (
          <Button
            key={q.id}
            variant="ghost"
            onClick={() => onSelectQuery(q.id)}
            className="w-full h-auto justify-start rounded-none text-left px-4 py-3"
          >
            <div className="w-full">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{q.name}</span>
                <span className="text-xs text-muted-foreground shrink-0 ml-2">
                  {q.visualizations.length} viz
                </span>
              </div>
              {q.description && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{q.description}</p>
              )}
              <div className="flex items-center gap-2 mt-1">
                {q.tags.map((t) => (
                  <Badge key={t} variant="secondary" className="text-[10px]">
                    {t}
                  </Badge>
                ))}
                {q.options.parameters.length > 0 && (
                  <Badge className="gap-1 border-status-stale bg-status-stale/10 text-[10px] text-status-stale">
                    <AlertTriangle className="h-2.5 w-2.5" />
                    {q.options.parameters.length} param(s)
                  </Badge>
                )}
              </div>
            </div>
          </Button>
        ))}
      </div>
    </div>
  )
}
