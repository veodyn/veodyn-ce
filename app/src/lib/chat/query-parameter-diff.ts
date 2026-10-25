import type { FieldChange } from './query-edit-summary'

type Definition = Record<string, unknown>

const NONE = 'None'

const COMPARED_FIELDS: { key: string; label: string }[] = [
  { key: 'type', label: 'type' },
  { key: 'title', label: 'title' },
  { key: 'value', label: 'default' },
  { key: 'enumOptions', label: 'options' },
  { key: 'queryId', label: 'query' },
  { key: 'multi', label: 'multiple values' },
  { key: 'quote', label: 'quoting' },
]

function show(value: unknown): string {
  if (value === undefined || value === null || value === '') return NONE
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

export function parameterChanges(before: Definition[] | undefined, after: Definition[]): FieldChange[] {
  const rows: FieldChange[] = []
  const previous = new Map((before ?? []).map((one) => [String(one.name), one]))
  const next = new Set(after.map((one) => String(one.name)))
  for (const [name, definition] of previous) {
    if (!next.has(name)) {
      rows.push({ field: `parameters:${name}`, label: `Parameter ${name}`, before: show(definition.type), after: 'Removed' })
    }
  }
  for (const definition of after) {
    const name = String(definition.name)
    const old = previous.get(name)
    if (!old) {
      rows.push({
        field: `parameters:${name}`,
        label: `Parameter ${name}`,
        before: NONE,
        after: `Added, ${show(definition.type)}`,
      })
      continue
    }
    for (const { key, label } of COMPARED_FIELDS) {
      if (same(old[key], definition[key])) continue
      rows.push({
        field: `parameters:${name}:${key}`,
        label: `Parameter ${name}: ${label}`,
        before: show(old[key]),
        after: show(definition[key]),
      })
    }
  }
  return rows
}
