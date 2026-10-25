'use client'

import { useId, type ChangeEvent } from 'react'
import { Label } from '../components/ui/label'
import type { ResultFilter } from '../lib/filters/result-filters'

export type ResultFilterSelections = Record<string, string[]>

interface ResultFilterControlsProps {
  filters: ResultFilter[]
  selections: ResultFilterSelections
  onChange: (next: ResultFilterSelections) => void
}

function FilterControl({
  filter,
  selected,
  onChange,
}: {
  filter: ResultFilter
  selected: string[]
  onChange: (values: string[]) => void
}) {
  const id = useId()
  const values = [...filter.values].sort((a, b) => a.localeCompare(b))
  const handle = (event: ChangeEvent<HTMLSelectElement>) => {
    const chosen = [...event.target.selectedOptions].map((option) => option.value)
    onChange(chosen.filter((value) => value !== ''))
  }
  return (
    <div data-veodyn-part="filter">
      <Label htmlFor={id}>{filter.friendlyName}</Label>
      <select
        id={id}
        multiple={filter.multiple}
        value={filter.multiple ? selected : (selected[0] ?? '')}
        onChange={handle}
      >
        {filter.multiple ? null : <option value="">All</option>}
        {values.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    </div>
  )
}

export function ResultFilterControls({ filters, selections, onChange }: ResultFilterControlsProps) {
  if (filters.length === 0) return null
  return (
    <div data-veodyn-part="filters">
      {filters.map((filter) => (
        <FilterControl
          key={filter.name}
          filter={filter}
          selected={selections[filter.name] ?? []}
          onChange={(values) => onChange({ ...selections, [filter.name]: values })}
        />
      ))}
    </div>
  )
}
