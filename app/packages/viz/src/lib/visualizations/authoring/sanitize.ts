import { sanitizeOptions, type OptionSchema } from '../option-schema'
import type { AuthoringField, AuthoringSchema } from './types'

function withinEnum(field: AuthoringField, value: unknown): unknown {
  const allowed = field.enum
  if (!allowed) return value
  if (field.rule === 'string') return typeof value === 'string' && allowed.includes(value) ? value : undefined
  if (typeof field.rule === 'object' && 'stringMap' in field.rule) {
    const entries = Object.entries(value as Record<string, string>)
    const kept = entries.filter(([, role]) => allowed.includes(role))
    if (entries.length > 0 && kept.length === 0) return undefined
    return Object.fromEntries(kept)
  }
  return value
}

export function sanitizeAuthored(schema: AuthoringSchema, options: unknown): Record<string, unknown> {
  const rules: OptionSchema = Object.fromEntries(Object.entries(schema).map(([key, field]) => [key, field.rule]))
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(sanitizeOptions(rules, options))) {
    const checked = withinEnum(schema[key], value)
    if (checked !== undefined) out[key] = checked
  }
  return out
}
