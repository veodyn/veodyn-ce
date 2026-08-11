'use client'

// The query editor's left rail: pick the data source, then browse its schema.
// Extracted from query-editor-page.tsx so the page stays a layout.
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SchemaBrowser } from './schema-browser'
import { SnippetPicker } from './snippet-picker'
import type { MockDataSource, SchemaTable } from '@/lib/mock-data'

interface QueryEditorSidebarProps {
  dataSources: MockDataSource[]
  dataSourceId: number
  onDataSourceIdChange: (id: number) => void
  schema: SchemaTable[]
  onInsert: (text: string) => void
}

export function QueryEditorSidebar({
  dataSources,
  dataSourceId,
  onDataSourceIdChange,
  schema,
  onInsert,
}: QueryEditorSidebarProps) {
  return (
    <div className="w-[300px] border-r bg-card overflow-hidden flex flex-col">
      <div className="p-3 border-b">
        {/* items is what lets SelectValue render the source's name: without it
            base-ui has no value-to-label map and falls back to printing the raw
            value, so this trigger read as a bare id ("1"). The list arrives
            async, so the same fallback applies to an id that is not in it YET;
            show the placeholder until one of them can be named. */}
        <Select
          value={dataSources.some((ds) => ds.id === dataSourceId) ? String(dataSourceId) : ''}
          items={dataSources.map((ds) => ({ label: ds.name, value: String(ds.id) }))}
          onValueChange={(v) => { if (v != null) onDataSourceIdChange(Number(v)) }}
        >
          <SelectTrigger aria-label="Data source" className="w-full h-8"><SelectValue placeholder="Select" /></SelectTrigger>
          <SelectContent>
            {dataSources.map((ds) => (
              <SelectItem key={ds.id} value={String(ds.id)}>{ds.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <SchemaBrowser schema={schema} dataSourceId={dataSourceId} onInsert={onInsert} />
      {/* Below the schema and on the same insert seam: both answer "what do I
          put in the query", one from the database and one from what the team
          has already written down. */}
      <SnippetPicker onInsert={onInsert} />
    </div>
  )
}
