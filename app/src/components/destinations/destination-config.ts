import type { FormField } from '@/components/forms/dynamic-form'

/**
 * The options body a destination form should actually send, and the check that
 * it is complete before it is sent.
 *
 * `schemaFields()` already carries `required` per field, straight off the
 * Redash `configuration_schema`, so nothing here re-reads the schema.
 */

// DynamicForm shows a field's schema default in the input but never writes it
// into the values object, so a form the user read as filled in submitted
// without those keys. Fold the defaults in at submit time so the request says
// what the screen said.
export function configOptions(
  fields: FormField[],
  values: Record<string, unknown>
): Record<string, unknown> {
  const options: Record<string, unknown> = {}
  for (const field of fields) {
    const value = values[field.name] ?? field.default
    if (value === undefined || value === null) continue
    options[field.name] = value
  }
  // Anything the user typed that the schema does not describe still belongs to
  // the destination (an older option the type has since dropped, say).
  for (const [key, value] of Object.entries(values)) {
    if (!(key in options) && value !== undefined) options[key] = value
  }
  return options
}

// A blank string is not an answer. Any other supplied value is, including a
// false checkbox and a zero.
function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true
  return typeof value === 'string' && value.trim() === ''
}

export function missingRequiredFields(
  fields: FormField[],
  options: Record<string, unknown>
): FormField[] {
  return fields.filter((field) => field.required && isBlank(options[field.name]))
}

// Redash rejects an incomplete config server-side, and that rejection used to
// be invisible. Name the fields instead of saying "invalid".
export function missingRequiredMessage(
  fields: FormField[],
  options: Record<string, unknown>
): string | null {
  const missing = missingRequiredFields(fields, options)
  if (missing.length === 0) return null
  return `Fill in the required ${missing.length === 1 ? 'field' : 'fields'}: ${missing
    .map((field) => field.title)
    .join(', ')}.`
}
