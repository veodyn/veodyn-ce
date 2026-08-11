'use client'

// The Data half of the Visual builder: the SELECT list (dimensions, measures),
// the clause rows it delegates to visual-builder-clauses, and the row limit.
// Presentational, so the owning VisualBuilder keeps the spec and the lock state
// and this file stays a layout over them.
//
// How the answer is drawn is the other half, and it lives in
// visual-builder-viz-picker. Row limit belongs here because it is how much data
// to fetch; it used to share a row with the chart select, which is what made the
// right-hand side of the card read as an empty panel with one control in it.
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { AiDatasetColumn, VisualAggFn, VisualAggregate, VisualFilter, VisualSort } from '@/types/ai'
import { FilterRows, SortRows } from './visual-builder-clauses'
import { FieldSection, FieldSelect, RemoveButton } from './visual-builder-controls'
import {
  AGGREGATE_FNS,
  columnNames,
  dimensionColumns,
  filterInputType,
  measureColumns,
  newAggregate,
  newFilter,
  newSort,
  removeAt,
  replaceAt,
  sortOptions,
  toOptions,
  toggleMember,
} from './visual-builder-model'

const ROW = 'grid items-center gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]'

export interface VisualBuilderFieldsProps {
  columns: AiDatasetColumn[]
  dimensions: string[]
  aggregates: VisualAggregate[]
  filters: VisualFilter[]
  sort: VisualSort[]
  limit: string
  /** Renders every control read-only. Nothing in the query editor sets it now
   *  that Visual and PRO switch freely; it stays for a caller that needs a
   *  frozen picker (a preview, a permissions-limited view). */
  disabled?: boolean
  onDimensionsChange: (next: string[]) => void
  onAggregatesChange: (next: VisualAggregate[]) => void
  onFiltersChange: (next: VisualFilter[]) => void
  onSortChange: (next: VisualSort[]) => void
  onLimitChange: (next: string) => void
}

export function VisualBuilderFields(props: VisualBuilderFieldsProps) {
  const { columns, dimensions, aggregates, filters, sort, disabled = false } = props
  const dimensionOptions = dimensionColumns(columns)
  const measures = measureColumns(columns)
  const measureOptions = toOptions(columnNames(measures))
  const sortColumnOptions = sortOptions(dimensions, aggregates, columns)

  function addAggregate() {
    const next = newAggregate(measures, aggregates)
    if (next) props.onAggregatesChange([...aggregates, next])
  }

  function addFilter() {
    const next = newFilter(columns)
    if (next) props.onFiltersChange([...filters, next])
  }

  function addSort() {
    const next = newSort(sortColumnOptions)
    if (next) props.onSortChange([...sort, next])
  }

  return (
    <div className="space-y-6">
      <FieldSection
        id="visual-dimensions"
        title="Dimensions"
        hint={
          dimensionOptions.length === 0
            ? 'This dataset has no text or date columns to group by.'
            : undefined
        }
      >
        <div className="flex flex-wrap gap-2">
          {dimensionOptions.map((column) => {
            // These chips are the SELECT list, so which ones are on is the
            // single most important thing this section shows. `secondary` made
            // that nearly invisible: #F0EDE6 on a #F7F5F0 background is a ~3%
            // step, and it dropped the chip's border rather than adding
            // anything. `--muted` is that same #F0EDE6, so hovering an
            // unselected chip rendered it exactly like a selected one.
            // `default` inverts the chip, which survives grayscale and any
            // colour vision.
            const selected = dimensions.includes(column.name)
            return (
              <Button
                key={column.name}
                type="button"
                size="sm"
                variant={selected ? 'default' : 'outline'}
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => props.onDimensionsChange(toggleMember(dimensions, column.name))}
              >
                {column.name}
              </Button>
            )
          })}
        </div>
      </FieldSection>

      <FieldSection
        id="visual-measures"
        title="Measures"
        hint={measures.length === 0 ? 'This dataset has no numeric columns to aggregate.' : undefined}
      >
        {aggregates.map((aggregate, index) => (
          <div key={`measure-${index}`} className={ROW}>
            <FieldSelect
              label={`Measure ${index + 1} column`}
              value={aggregate.column}
              options={measureOptions}
              disabled={disabled}
              onChange={(column) =>
                props.onAggregatesChange(replaceAt(aggregates, index, { ...aggregate, column }))
              }
            />
            <FieldSelect
              label={`Measure ${index + 1} function`}
              value={aggregate.fn}
              options={toOptions(AGGREGATE_FNS)}
              disabled={disabled}
              onChange={(fn) =>
                props.onAggregatesChange(
                  replaceAt(aggregates, index, { ...aggregate, fn: fn as VisualAggFn })
                )
              }
            />
            <Input
              aria-label={`Measure ${index + 1} alias`}
              className="font-mono"
              value={aggregate.alias}
              disabled={disabled}
              onChange={(event) =>
                props.onAggregatesChange(
                  replaceAt(aggregates, index, { ...aggregate, alias: event.target.value })
                )
              }
            />
            <RemoveButton
              label={`Remove measure ${index + 1}`}
              disabled={disabled}
              onClick={() => props.onAggregatesChange(removeAt(aggregates, index))}
            />
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || measures.length === 0}
          onClick={addAggregate}
        >
          <Plus aria-hidden="true" />
          Add measure
        </Button>
      </FieldSection>

      <FilterRows
        filters={filters}
        columnOptions={toOptions(columnNames(columns))}
        inputTypeFor={(column) => filterInputType(column, columns)}
        disabled={disabled}
        onChange={props.onFiltersChange}
        onAdd={addFilter}
      />

      <SortRows
        sort={sort}
        columnOptions={sortColumnOptions}
        disabled={disabled}
        onChange={props.onSortChange}
        onAdd={addSort}
      />

      <div className="max-w-xs space-y-2">
        <Label htmlFor="visual-limit">Row limit</Label>
        <Input
          id="visual-limit"
          type="number"
          min={0}
          step={1}
          className="font-mono tabular-nums"
          value={props.limit}
          disabled={disabled}
          onChange={(event) => props.onLimitChange(event.target.value)}
        />
      </div>
    </div>
  )
}
