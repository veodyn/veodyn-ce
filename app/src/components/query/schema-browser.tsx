'use client'

import { useState } from 'react'
import { ChevronRight, Eye, Search, Table2, Columns } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { IconButton } from '@/components/shared/icon-button'
import { TablePreviewDialog, type PreviewTarget } from './table-preview-dialog'
import type { SchemaTable } from '@/lib/mock-data'

interface SchemaBrowserProps {
  schema: SchemaTable[]
  dataSourceId: number
  onInsert: (text: string) => void
}

export function SchemaBrowser({ schema, dataSourceId, onInsert }: SchemaBrowserProps) {
  const [search, setSearch] = useState('')
  // What the preview dialog is open for, or null when it is closed. The data
  // source is captured with the table rather than read live, so the pair on
  // screen is the pair that was clicked.
  const [preview, setPreview] = useState<PreviewTarget | null>(null)

  const filteredSchema = schema.filter((table) => {
    // Some schema endpoints pad the list with separator rows: an empty name,
    // or a run of box-drawing dashes. They are not tables, and since the row
    // key is the name, two of them made React warn about duplicate keys.
    if (!/[\p{L}\p{N}]/u.test(table.name)) return false
    if (!search) return true
    const s = search.toLowerCase()
    return (
      table.name.toLowerCase().includes(s) ||
      table.columns.some((c) => c.name.toLowerCase().includes(s))
    )
  })

  return (
    <>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="p-2">
          <InputGroup>
            <InputGroupAddon>
              <Search className="h-3.5 w-3.5" />
            </InputGroupAddon>
            <InputGroupInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search schema..."
            />
          </InputGroup>
        </div>
        <div className="text-xs">
          {filteredSchema.length === 0 && (
            <div className="px-3 py-4 text-center text-muted-foreground">
              {schema.length === 0 ? 'No schema available' : 'No matches'}
            </div>
          )}
          {filteredSchema.map((table) => (
            <Collapsible key={table.name}>
              {/* The row is a flex container rather than one button so the eye
                  sits beside the expander instead of inside it: a button within
                  a button is not markup a browser will honour. */}
              <div className="group flex items-center transition-colors hover:bg-muted/50">
                <CollapsibleTrigger className="group/trigger flex min-w-0 flex-1 items-center gap-1 px-2 py-1.5 text-left">
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-200 group-data-panel-open/trigger:rotate-90" />
                  <Table2 className="h-3 w-3 shrink-0 text-primary" />
                  <span
                    className="truncate font-medium cursor-pointer hover:text-primary"
                    onClick={(e) => {
                      e.stopPropagation()
                      onInsert(table.name)
                    }}
                  >
                    {table.name}
                  </span>
                </CollapsibleTrigger>
                <IconButton
                  tooltip="Preview table"
                  aria-label={`Preview ${table.name}`}
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setPreview({ table, dataSourceId })}
                  // Hidden until the row is hovered or the button itself is
                  // focused, so a tree read at a glance stays a list of names
                  // rather than a column of icons.
                  className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Eye className="h-3.5 w-3.5" />
                </IconButton>
                <span className="shrink-0 pr-2 pl-1 text-muted-foreground">
                  {table.columns.length}
                </span>
              </div>
              <CollapsibleContent className="ml-4">
                {/* Keyed by position: a connector's "Query Examples" table
                    lists documentation lines as columns, and a spacer line or
                    a rule repeats, so the name alone is not unique. Blank
                    lines are spacing in that listing and draw nothing. */}
                {table.columns.map((col, index) =>
                  col.name.trim() === '' ? null : (
                  <Button
                    key={`${index}:${col.name}`}
                    variant="ghost"
                    onClick={() => onInsert(col.name)}
                    className="h-auto w-full justify-start gap-1.5 rounded-none px-2 py-1 text-left text-xs font-normal hover:bg-muted/50"
                  >
                    <Columns className="size-2.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{col.name}</span>
                    <span className="ml-auto truncate text-muted-foreground">{col.type}</span>
                  </Button>
                  )
                )}
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      </div>
      <TablePreviewDialog target={preview} onClose={() => setPreview(null)} />
    </>
  )
}
