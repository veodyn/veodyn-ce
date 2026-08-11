'use client'

import { useId } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { QueryResultColumn } from '@/lib/mock-data'
import type { RedashWordCloudOptions } from '@/services/redash/types'

interface WordCloudEditorProps {
  options: Record<string, unknown>
  columns: QueryResultColumn[]
  onChange: (options: Record<string, unknown>) => void
}

type LimitKey = 'wordLengthLimit' | 'wordCountLimit'

export function WordCloudEditor({ options: rawOptions, columns, onChange }: WordCloudEditorProps) {
  const options = rawOptions as RedashWordCloudOptions

  const columnId = useId()
  const frequenciesColumnId = useId()
  const lengthMinId = useId()
  const lengthMaxId = useId()
  const countMinId = useId()
  const countMaxId = useId()

  const update = (key: keyof RedashWordCloudOptions, value: unknown) => {
    onChange({ ...rawOptions, [key]: value })
  }

  // buildWordCloudModel branches on truthiness (`options.frequenciesColumn ? ...`),
  // so an empty string reads the same as unset to the renderer while still
  // riding along in the options that get saved back to Redash. Drop the key.
  const clear = (key: keyof RedashWordCloudOptions) => {
    const next = { ...rawOptions }
    delete next[key]
    onChange(next)
  }

  // Both column pickers carry a reset item whose value is '', which is the one
  // value that means "unset" rather than a column name.
  const setColumnOption = (key: 'column' | 'frequenciesColumn', value: string) => {
    if (value) update(key, value)
    else clear(key)
  }

  const updateLimit = (key: LimitKey, bound: 'min' | 'max', raw: string) => {
    const limit = { ...(options[key] ?? {}) }
    const value = Number(raw)
    // A blank field means "no bound", which the model spells as an absent key
    // (it tests `min == null`), not as 0. Number('') is 0, so the blank case has
    // to be caught before the conversion.
    if (raw === '' || !Number.isFinite(value)) delete limit[bound]
    else limit[bound] = value

    const next = { ...rawOptions }
    // Drop the whole limit object once neither bound is set, for the same
    // reason as `clear` above: no dead keys in the saved options.
    if (limit.min == null && limit.max == null) delete next[key]
    else next[key] = limit
    onChange(next)
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor={columnId} className="mb-1 block">Words Column</Label>
        <Select value={options.column || ''} onValueChange={(v) => setColumnOption('column', v ?? '')}>
          <SelectTrigger id={columnId} className="w-full h-8">
            <SelectValue placeholder="Select column..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Select column...</SelectItem>
            {columns.map((c) => (
              <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">Required: nothing renders without it. On its own, the text in each row is split on whitespace and every word is counted across all rows.</p>
      </div>
      <div>
        <Label htmlFor={frequenciesColumnId} className="mb-1 block">Frequencies Column (optional)</Label>
        <Select
          value={options.frequenciesColumn || ''}
          onValueChange={(v) => setColumnOption('frequenciesColumn', v ?? '')}
        >
          <SelectTrigger id={frequenciesColumnId} className="w-full h-8">
            <SelectValue placeholder="None (count words in the text)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">None (count words in the text)</SelectItem>
            {columns.map((c) => (
              <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">Set it to stop counting words: each row then becomes one word, taken whole and not split, sized by the number in this column. Rows whose number is missing, zero or negative are skipped, and when the same word appears in several rows the last row wins.</p>
      </div>
      <div>
        {/* A heading over the pair below, not a label for either input: each input names itself. */}
        <div className="text-sm font-medium mb-1">Word Length Limit</div>
        <div className="flex gap-2">
          <div className="flex-1">
            <Label htmlFor={lengthMinId} className="mb-1 block text-xs text-muted-foreground">Min characters</Label>
            <Input
              id={lengthMinId}
              type="number"
              min={1}
              value={options.wordLengthLimit?.min ?? ''}
              onChange={(e) => updateLimit('wordLengthLimit', 'min', e.target.value)}
              className="h-8"
              placeholder="any"
            />
          </div>
          <div className="flex-1">
            <Label htmlFor={lengthMaxId} className="mb-1 block text-xs text-muted-foreground">Max characters</Label>
            <Input
              id={lengthMaxId}
              type="number"
              min={1}
              value={options.wordLengthLimit?.max ?? ''}
              onChange={(e) => updateLimit('wordLengthLimit', 'max', e.target.value)}
              className="h-8"
              placeholder="any"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">Hides words outside this length. Sizes and colours are assigned before the limit is applied, so hiding a word never resizes the ones that stay.</p>
      </div>
      <div>
        {/* Same as above: a heading, and the two inputs carry the labels. */}
        <div className="text-sm font-medium mb-1">Word Count Limit</div>
        <div className="flex gap-2">
          <div className="flex-1">
            <Label htmlFor={countMinId} className="mb-1 block text-xs text-muted-foreground">Min count</Label>
            <Input
              id={countMinId}
              type="number"
              min={1}
              value={options.wordCountLimit?.min ?? ''}
              onChange={(e) => updateLimit('wordCountLimit', 'min', e.target.value)}
              className="h-8"
              placeholder="any"
            />
          </div>
          <div className="flex-1">
            <Label htmlFor={countMaxId} className="mb-1 block text-xs text-muted-foreground">Max count</Label>
            <Input
              id={countMaxId}
              type="number"
              min={1}
              value={options.wordCountLimit?.max ?? ''}
              onChange={(e) => updateLimit('wordCountLimit', 'max', e.target.value)}
              className="h-8"
              placeholder="any"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">Hides words outside this count. The count is how often the word appears, or the frequencies column value when one is set.</p>
      </div>
    </div>
  )
}
