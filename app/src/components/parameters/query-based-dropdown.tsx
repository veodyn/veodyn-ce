'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useQueryById } from '@/hooks/use-queries'
import { useQueryResult } from '@/hooks/use-query-execution'

interface QueryBasedDropdownProps {
  id?: string
  queryId: number
  value: unknown
  onChange: (value: unknown) => void
  /** Set for a parameter whose definition allows several values. */
  multiple?: boolean
}

export function QueryBasedDropdown({
  id,
  queryId,
  value,
  onChange,
  multiple = false,
}: QueryBasedDropdownProps) {
  const { data: query } = useQueryById(queryId)
  const { data: queryResult } = useQueryResult(query?.latest_query_data_id)

  const options = queryResult?.data?.rows?.map((row) => {
    const vals = Object.values(row)
    return { value: String(vals[0]), label: vals.length > 1 ? String(vals[1]) : String(vals[0]) }
  }) ?? []

  // Pass the value/label pairs as `items` so the trigger can resolve the
  // selected option's label immediately, without needing its <SelectItem>
  // mounted first (base-ui only mounts popup items once the select opens).
  const items = [{ value: '', label: 'Select...' }, ...options]

  if (multiple) {
    const selected = Array.isArray(value) ? value : []
    return (
      // No empty "Select..." entry here: in a multi-select, clearing is done by
      // deselecting, and an option whose value is '' would be a selectable
      // blank that the backend then has to reject.
      <Select multiple value={selected} onValueChange={onChange} items={options}>
        <SelectTrigger id={id} size="sm" className="w-full min-w-32">
          <SelectValue placeholder="None">
            {(v: string[]) =>
              v.length === 0
                ? 'None'
                : v.length === 1
                  ? (options.find((o) => o.value === v[0])?.label ?? v[0])
                  : `${v.length} selected`
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((opt, i) => (
            <SelectItem key={i} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  return (
    <Select value={String(value ?? '')} onValueChange={(v) => onChange(v)} items={items}>
      <SelectTrigger id={id} size="sm" className="w-full">
        <SelectValue placeholder="Select..." />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">Select...</SelectItem>
        {options.map((opt, i) => (
          <SelectItem key={i} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
