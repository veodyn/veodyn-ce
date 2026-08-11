'use client'

import { useId, useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useQueries } from '@/hooks/use-queries'
import type { MockQueryParameter } from '@/lib/mock-data'

interface ParameterSettingsDialogProps {
  open: boolean
  parameter: MockQueryParameter
  onClose: () => void
  onSave: (parameter: MockQueryParameter) => void
}

/** Redash's own list and labels, so a query moved between the two reads the same. */
const TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'enum', label: 'Dropdown List' },
  { value: 'query', label: 'Query Based Dropdown List' },
  { value: 'date', label: 'Date' },
  { value: 'datetime-local', label: 'Date and Time' },
  { value: 'datetime-with-seconds', label: 'Date and Time (with seconds)' },
  { value: 'date-range', label: 'Date Range' },
  { value: 'datetime-range', label: 'Date and Time Range' },
  { value: 'datetime-range-with-seconds', label: 'Date and Time Range (with seconds)' },
]

/** The quoting wrapped around each value before the backend joins the list. */
const QUOTATIONS = [
  { value: 'none', label: 'None (default)', mark: '' },
  { value: 'single', label: 'Single quotation mark', mark: "'" },
  { value: 'double', label: 'Double quotation mark', mark: '"' },
]

/** Only these two can hold several values, matching Redash. */
const MULTI_CAPABLE = ['enum', 'query']

function quotationKeyOf(parameter: MockQueryParameter): string {
  const prefix = parameter.multiValuesOptions?.prefix
  return QUOTATIONS.find((q) => q.mark === prefix)?.value ?? 'none'
}

export function ParameterSettingsDialog({
  open,
  parameter,
  onClose,
  onSave,
}: ParameterSettingsDialogProps) {
  const [title, setTitle] = useState(parameter.title || parameter.name)
  const [type, setType] = useState(parameter.type)
  const [enumOptions, setEnumOptions] = useState(parameter.enumOptions ?? '')
  const [queryId, setQueryId] = useState<number | null>(parameter.queryId ?? null)
  const [multi, setMulti] = useState(Boolean(parameter.multiValuesOptions))
  const [quotation, setQuotation] = useState(quotationKeyOf(parameter))

  const titleId = useId()
  const typeId = useId()
  const valuesId = useId()
  const queryFieldId = useId()
  const multiId = useId()
  const quotationId = useId()

  const { data: queriesData } = useQueries()
  const queries = queriesData?.results ?? []

  const isEnum = type === 'enum'
  const isQueryBacked = type === 'query'
  const canBeMulti = MULTI_CAPABLE.includes(type)

  const handleSave = () => {
    const mark = QUOTATIONS.find((q) => q.value === quotation)?.mark ?? ''
    // Rebuilt from the current type rather than spread over the old parameter,
    // so settings a type cannot use do not survive a type change. The name is
    // the one thing that never changes here: it is what the SQL references.
    const next: MockQueryParameter = {
      name: parameter.name,
      title: title.trim() || parameter.name,
      type,
      value: parameter.value,
    }
    if (isEnum) next.enumOptions = enumOptions
    if (isQueryBacked && queryId != null) next.queryId = queryId
    if (canBeMulti && multi) {
      next.multiValuesOptions = { prefix: mark, suffix: mark, separator: ',' }
    }

    onSave(next)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Parameter settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            {/* Not editable: the SQL references this name, and renaming it here
                without rewriting the query would drop the parameter on the next
                sync and quietly create a fresh one under the new name. */}
            <div className="mb-1 text-sm font-medium">Keyword</div>
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{parameter.name}</code>
            <p className="mt-1 text-xs text-muted-foreground">
              Rename it in the query text to change it.
            </p>
          </div>

          <div>
            <Label htmlFor={titleId} className="mb-1 block">Title</Label>
            <Input id={titleId} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div>
            <Label htmlFor={typeId} className="mb-1 block">Type</Label>
            <Select value={type} onValueChange={(v) => v && setType(v)}>
              <SelectTrigger id={typeId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isEnum && (
            <div>
              <Label htmlFor={valuesId} className="mb-1 block">Values</Label>
              <Textarea
                id={valuesId}
                rows={4}
                value={enumOptions}
                onChange={(e) => setEnumOptions(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">One value per line.</p>
            </div>
          )}

          {isQueryBacked && (
            <div>
              <Label htmlFor={queryFieldId} className="mb-1 block">Query</Label>
              <Select
                value={queryId == null ? '' : String(queryId)}
                onValueChange={(v) => setQueryId(v ? Number(v) : null)}
              >
                <SelectTrigger id={queryFieldId}>
                  <SelectValue placeholder="Select a query" />
                </SelectTrigger>
                <SelectContent>
                  {queries.map((q) => (
                    <SelectItem key={q.id} value={String(q.id)}>
                      {q.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                Its first column supplies the values, the second their labels.
              </p>
            </div>
          )}

          {canBeMulti && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Switch id={multiId} checked={multi} onCheckedChange={setMulti} />
                <Label htmlFor={multiId}>Allow multiple values</Label>
              </div>

              {multi && (
                <div>
                  <Label htmlFor={quotationId} className="mb-1 block">Quotation</Label>
                  <Select value={quotation} onValueChange={(v) => v && setQuotation(v)}>
                    <SelectTrigger id={quotationId}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {QUOTATIONS.map((q) => (
                        <SelectItem key={q.value} value={q.value}>
                          {q.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Wrapped around each value before they are joined with commas.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
