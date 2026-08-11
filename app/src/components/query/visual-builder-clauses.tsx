'use client'

// The WHERE and ORDER BY halves of the field picker. Same row shape as the
// SELECT-list sections, but they draw from different option sets: a filter can
// name any schema column, while a sort may also name a selected dimension or an
// aggregate alias, which is exactly what compileVisualQuery accepts there.
import { useId } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { VisualFilter, VisualSort } from '@/types/ai'
import { FieldSection, FieldSelect, RemoveButton } from './visual-builder-controls'
import {
  FILTER_OPS,
  SORT_DIRECTIONS,
  type Option,
  isIncompleteFilter,
  removeAt,
  replaceAt,
  toOptions,
} from './visual-builder-model'

const TRIPLE_ROW = 'grid items-center gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]'
const PAIR_ROW = 'grid items-center gap-2 sm:grid-cols-[1fr_1fr_auto]'

export function FilterRows({
  filters,
  columnOptions,
  inputTypeFor,
  disabled,
  onChange,
  onAdd,
}: {
  filters: VisualFilter[]
  columnOptions: Option[]
  /** The control a value on this column deserves; see filterInputType. */
  inputTypeFor: (column: string) => 'text' | 'date' | 'datetime-local'
  disabled: boolean
  onChange: (next: VisualFilter[]) => void
  onAdd: () => void
}) {
  const hintId = useId()

  return (
    <FieldSection id="visual-filters" title="Filters">
      {filters.map((filter, index) => {
        // A row without a value is unfinished, not wrong. It is left out of the
        // query and says so here, next to the box that needs filling in, rather
        // than raising the card-level alert that used to switch Run off the
        // moment a row was added.
        const incomplete = isIncompleteFilter(filter)
        const rowHintId = `${hintId}-${index}`

        return (
          <div key={`filter-${index}`} className="space-y-1">
            <div className={TRIPLE_ROW}>
              <FieldSelect
                label={`Filter ${index + 1} column`}
                value={filter.column}
                options={columnOptions}
                disabled={disabled}
                onChange={(column) => onChange(replaceAt(filters, index, { ...filter, column }))}
              />
              <FieldSelect
                label={`Filter ${index + 1} operator`}
                value={filter.op}
                options={toOptions(FILTER_OPS)}
                disabled={disabled}
                onChange={(op) =>
                  onChange(replaceAt(filters, index, { ...filter, op: op as VisualFilter['op'] }))
                }
              />
              <Input
                aria-label={`Filter ${index + 1} value`}
                aria-describedby={incomplete ? rowHintId : undefined}
                type={inputTypeFor(filter.column)}
                className="font-mono tabular-nums"
                value={filter.value}
                disabled={disabled}
                onChange={(event) =>
                  onChange(replaceAt(filters, index, { ...filter, value: event.target.value }))
                }
              />
              <RemoveButton
                label={`Remove filter ${index + 1}`}
                disabled={disabled}
                onClick={() => onChange(removeAt(filters, index))}
              />
            </div>
            {incomplete && (
              <p id={rowHintId} className="text-xs text-muted-foreground">
                Add a value to apply this filter.
              </p>
            )}
          </div>
        )
      })}
      <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onAdd}>
        <Plus aria-hidden="true" />
        Add filter
      </Button>
    </FieldSection>
  )
}

export function SortRows({
  sort,
  columnOptions,
  disabled,
  onChange,
  onAdd,
}: {
  sort: VisualSort[]
  columnOptions: Option[]
  disabled: boolean
  onChange: (next: VisualSort[]) => void
  onAdd: () => void
}) {
  return (
    <FieldSection id="visual-sort" title="Sort">
      {sort.map((entry, index) => (
        <div key={`sort-${index}`} className={PAIR_ROW}>
          <FieldSelect
            label={`Sort ${index + 1} column`}
            value={entry.column}
            options={columnOptions}
            disabled={disabled}
            onChange={(column) => onChange(replaceAt(sort, index, { ...entry, column }))}
          />
          <FieldSelect
            label={`Sort ${index + 1} direction`}
            value={entry.dir}
            options={SORT_DIRECTIONS}
            disabled={disabled}
            onChange={(dir) =>
              onChange(replaceAt(sort, index, { ...entry, dir: dir as VisualSort['dir'] }))
            }
          />
          <RemoveButton
            label={`Remove sort ${index + 1}`}
            disabled={disabled}
            onClick={() => onChange(removeAt(sort, index))}
          />
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onAdd}>
        <Plus aria-hidden="true" />
        Add sort
      </Button>
    </FieldSection>
  )
}
