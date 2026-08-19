'use client'

import type { GtfsField } from '@/lib/gtfs-fields'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface ColumnMapEditorProps {
  /** The bound query's latest result columns, or [] when it has never run. */
  columns: string[]
  /** The standard's own field vocabulary. A map built from the wrong one
   *  names fields its serializer does not write. */
  fields: GtfsField[]
  selection: Record<string, string | null>
  onChange: (field: string, column: string | null) => void
  fieldErrors?: Record<string, string>
}

// A sentinel rather than an empty string: an empty string is a legal Select
// item value here (unlike the param-mapping table next door), and the
// primitive's own placeholder handling treats "" as a real selection, not as
// nothing chosen.
const NOT_MAPPED = '__not_mapped__'

/**
 * A Table with a row per `fields` entry, each row a Select over the
 * query's known result columns. `items` is passed explicitly rather than
 * derived from SelectItem children, because the options here are query-backed
 * (see the doc comment on `Select` in @/components/ui/select).
 *
 * When the bound query has never produced a result, `columns` is empty and
 * there is nothing to offer: rather than a table of Selects with only "not
 * mapped" ever selectable, this renders the one fact that matters instead.
 */
export function ColumnMapEditor({ columns, fields, selection, onChange, fieldErrors }: ColumnMapEditorProps) {
  if (columns.length === 0) {
    return (
      <Table>
        <TableBody>
          <TableRow>
            <TableCell className="whitespace-normal py-4 text-sm text-muted-foreground">
              This query has not produced a result yet, so its columns are unknown. The mapping can
              still be saved, but nothing has checked it.
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
  }

  const items = [{ value: NOT_MAPPED, label: 'Not mapped' }, ...columns.map((c) => ({ value: c, label: c }))]

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Field</TableHead>
          <TableHead>Column</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {fields.map((field) => {
          const value = selection[field.name] ?? NOT_MAPPED
          const fieldError = fieldErrors?.[field.name]
          return (
            <TableRow key={field.name}>
              <TableCell className="align-top">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-sm">{field.name}</span>
                  {field.required && (
                    <span className="text-xs text-muted-foreground">required</span>
                  )}
                </div>
                {fieldError && (
                  <p role="alert" className="mt-1 text-xs text-destructive">
                    {fieldError}
                  </p>
                )}
              </TableCell>
              <TableCell>
                <Select
                  items={items}
                  value={value}
                  onValueChange={(v) => {
                    // Base UI's Select can emit null on clear; there is
                    // nothing meaningful to write back for that here, since
                    // NOT_MAPPED is already the "cleared" value.
                    if (v == null) return
                    onChange(field.name, v === NOT_MAPPED ? null : v)
                  }}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {items.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
