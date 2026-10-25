import { UNUSED_COLUMN, type AuthoringColumnKind, type AuthoringSchema } from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNamed(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value !== UNUSED_COLUMN
}

function referencedColumns(kind: AuthoringColumnKind, value: unknown): string[] {
  if (kind === 'one') return isNamed(value) ? [value] : []
  if (kind === 'list') return Array.isArray(value) ? value.filter(isNamed) : []
  if (kind === 'mapKeys') {
    if (!isRecord(value)) return []
    return Object.entries(value)
      .filter(([, role]) => isNamed(role))
      .map(([name]) => name)
  }
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => (isRecord(entry) && isNamed(entry.name) ? [entry.name] : []))
}

export function authoredColumnProblems(
  schema: AuthoringSchema,
  options: Record<string, unknown>,
  columnNames: string[]
): string[] {
  const known = new Set(columnNames)
  const problems: string[] = []
  for (const [key, field] of Object.entries(schema)) {
    if (!field.column) continue
    if (field.appliesTo && options[field.appliesTo.key] !== field.appliesTo.equals) continue
    for (const name of referencedColumns(field.column, options[key])) {
      if (!known.has(name)) problems.push(`${key}: no column named ${name}`)
    }
  }
  return problems
}
