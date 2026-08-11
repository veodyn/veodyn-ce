'use client'

import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { QueryResultColumn } from '@/lib/mock-data'
import type { RedashCohortOptions } from '@/services/redash/types'

interface CohortEditorProps {
  options: Record<string, unknown>
  columns: QueryResultColumn[]
  onChange: (options: Record<string, unknown>) => void
}

export function CohortEditor({ options: rawOptions, columns, onChange }: CohortEditorProps) {
  const options = rawOptions as RedashCohortOptions

  const dateColumnId = useId()
  const stageColumnId = useId()
  const totalColumnId = useId()
  const valueColumnId = useId()

  const update = (key: keyof RedashCohortOptions, value: unknown) => {
    onChange({ ...rawOptions, [key]: value })
  }

  // The four keys are Redash's own (viz-lib cohort/getOptions), so a cohort
  // saved in Redash renders here and one saved here renders there. The LABELS
  // are not: Redash calls these "Date (Bucket)", "Stage", "Bucket Population
  // Size" and "Stage Value", which say nothing to someone reading the grid
  // this app draws. These follow the renderer's own vocabulary instead
  // (cohort, stage, total), so the editor and the visualization agree.
  //
  // Declared as one list because the same four fields drive both the selects
  // and the missing-column hint below; two hand-kept copies would drift the
  // moment a label changed.
  const fields = [
    {
      id: dateColumnId,
      key: 'dateColumn',
      label: 'Cohort Column',
      hint: 'The bucket a row belongs to, usually a signup or first-seen date.',
    },
    {
      id: stageColumnId,
      key: 'stageColumn',
      label: 'Stage Column',
      hint: 'Periods elapsed since the cohort started (0, 1, 2...). Becomes the grid columns.',
    },
    {
      id: totalColumnId,
      key: 'totalColumn',
      label: 'Cohort Total Column',
      hint: "The cohort's population, the denominator every cell is a percentage of.",
    },
    {
      id: valueColumnId,
      key: 'valueColumn',
      label: 'Value Column',
      hint: 'How many of that cohort were still present at that stage.',
    },
  ] as const

  // buildCohortModel returns an empty grid unless all four are set
  // (src/components/visualizations/cohort-model.ts), and the renderer's own
  // fallback text names the columns generically. Listing the ones still
  // missing here is the difference between "I have not finished configuring
  // this" and a visualization that looks broken.
  const missing = fields.filter((field) => !options[field.key])

  return (
    <div className="space-y-4">
      {fields.map((field) => (
        <div key={field.key}>
          <Label htmlFor={field.id} className="mb-1 block">{field.label}</Label>
          <Select value={options[field.key] || ''} onValueChange={(v) => update(field.key, v)}>
            <SelectTrigger id={field.id} className="w-full h-8">
              <SelectValue placeholder="Select column..." />
            </SelectTrigger>
            <SelectContent>
              {/* Keeps a chosen column clearable: without this item the select has no way back to unset. */}
              <SelectItem value="">Select column...</SelectItem>
              {columns.map((c) => (
                <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">{field.hint}</p>
        </div>
      ))}
      {missing.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Still needed: {missing.map((field) => field.label).join(', ')}. The grid stays empty until all
          four columns are set.
        </p>
      )}
    </div>
  )
}
