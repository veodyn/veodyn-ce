import { authoredColumnProblems, authoringFor, sanitizeAuthored, type AuthoringSchema } from '@veodyn/viz/authoring'

export function vizOptionProblems(
  type: string,
  options: Record<string, unknown> | undefined,
  columnNames: string[]
): string[] {
  const schema = authoringFor(type)
  if (!schema) return []
  return authoredColumnProblems(schema, sanitizedVizOptions(type, options), columnNames)
}

export function declaredDefaults(schema: AuthoringSchema): Record<string, unknown> {
  const defaults: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(schema)) {
    if (field.default !== undefined) defaults[key] = field.default
  }
  return defaults
}

export function sanitizedVizOptions(type: string, options: Record<string, unknown> | undefined): Record<string, unknown> {
  const schema = authoringFor(type)
  return schema ? sanitizeAuthored(schema, options ?? {}) : {}
}
