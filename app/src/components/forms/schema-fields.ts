// Turns a Redash `configuration_schema` into DynamicForm fields.
//
// Four pages (data sources new/edit, destinations new/edit) each had their own
// copy of this mapping and none of them mapped `boolean`, so a boolean option
// rendered as a free-text input. Typing "false" into it stored the string
// "false", which is truthy on the Python side: the control did the opposite of
// what it read. `enable_historical_capture`, which the fork's connector base
// puts on every connector built from it, is one of those.
import { jsonFieldError, type FormField } from './dynamic-form'

export interface RedashConfigSchema {
  properties?: Record<string, { type?: string; title?: string; default?: unknown; description?: string }>
  required?: string[]
  secret?: string[]
  order?: string[]
}

// A schema string field that holds a JSON document, not a scalar, has no
// tighter JSON Schema type to say so: `type: "string"` is all the wire format
// offers. The connectors that need this (ntcip_dms's device list,
// gtfs_realtime's route label map) already name it in the title instead -
// "Devices (JSON)", "Route labels (JSON object, optional)" - so that title is
// read back here rather than adding a schema field nothing else produces.
function looksLikeJsonField(title: string): boolean {
  return /\(json\b/i.test(title)
}

// Secret wins over the declared type: a secret is always a password input,
// whatever the schema calls it. A json-shaped title only applies to a plain
// string field; a boolean or number is never reinterpreted as JSON text.
function fieldType(name: string, declared: string | undefined, title: string, secret: string[]): string {
  if (secret.includes(name)) return 'password'
  if (declared === 'boolean') return 'boolean'
  if (declared === 'number') return 'number'
  if (looksLikeJsonField(title)) return 'json'
  return 'string'
}

export function schemaFields(schema: RedashConfigSchema | undefined): FormField[] {
  if (!schema?.properties) return []

  const required = schema.required ?? []
  const secret = schema.secret ?? []
  const fields = Object.entries(schema.properties).map(([name, prop]) => {
    const title = prop.title || name
    return {
      name,
      title,
      type: fieldType(name, prop.type, title, secret),
      default: prop.default,
      required: required.includes(name),
      description: prop.description,
    }
  })

  // Redash schemas may declare the order fields should appear in; anything the
  // list does not name keeps its schema position, after the ones it does.
  const order = schema.order
  if (!order?.length) return fields
  const rank = (name: string) => (order.indexOf(name) === -1 ? order.length : order.indexOf(name))
  return fields.sort((a, b) => rank(a.name) - rank(b.name))
}

// A page's pre-submit check for the json fields DynamicForm already flags
// inline. Save is exactly where a shape error the user typed past has to be
// caught for real: the field-level message is visible the whole time, but
// nothing stopped a click on Save before this named the offending field and
// blocked the request.
export function invalidJsonMessage(fields: FormField[], values: Record<string, unknown>): string | null {
  const invalid = fields.filter(
    (field) => field.type === 'json' && jsonFieldError(values[field.name] ?? field.default, field.name) !== null
  )
  if (invalid.length === 0) return null
  return `Fix the invalid JSON in the ${invalid.length === 1 ? 'field' : 'fields'}: ${invalid
    .map((field) => field.title)
    .join(', ')}.`
}
