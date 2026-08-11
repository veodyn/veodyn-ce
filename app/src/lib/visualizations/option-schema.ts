// The vocabulary a visualization uses to declare which of its options may
// leave the product.
//
// This lives in the visualization layer rather than beside the public report
// code because the declaration belongs to the type: a plugin knows which of its
// own options a renderer reads, and nothing outside it does. It carries no
// React and no app imports, so a plugin can declare a schema without pulling
// the host app in behind it.
//
// The rules describe SHAPE, not sensitivity. Declaring a key here is a
// statement that its value is safe to hand an unauthenticated reader, so the
// vocabulary is deliberately narrow: primitives and containers of primitives,
// every key named. There is no passthrough rule and no `unknown`, because an
// options bag in the wild carries whatever an author, a promote-a-dashboard
// copy, or a backend regression left in it.
export type OptionRule =
  | 'string'
  | 'number'
  | 'boolean'
  // Record<string, string>: a chart-style column mapping and nothing else.
  | { stringMap: true }
  | { object: Record<string, OptionRule> }
  // Record<string, <object>>: keyed series options.
  | { objectMap: Record<string, OptionRule> }
  | { array: OptionRule }

/** One visualization type's declaration: option key to the shape allowed. */
export type OptionSchema = Record<string, OptionRule>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// A container that arrived with entries and kept none of them was carrying
// something the schema refused, so the key goes with it rather than leaving an
// empty shell behind. A container that was already empty is the author's own
// empty value and is kept as it stands.
function survivors<T>(out: T, sourceSize: number, keptSize: number): T | undefined {
  return sourceSize > 0 && keptSize === 0 ? undefined : out
}

// Returns the value to keep, or `undefined` for "this does not belong in an
// anonymous response". Recursive, so a schema-shaped wrapper around a
// non-schema payload is opened rather than trusted.
function sanitizeValue(rule: OptionRule, value: unknown): unknown {
  if (rule === 'string') return typeof value === 'string' ? value : undefined
  if (rule === 'number') return typeof value === 'number' && Number.isFinite(value) ? value : undefined
  if (rule === 'boolean') return typeof value === 'boolean' ? value : undefined

  if ('stringMap' in rule) {
    if (!isRecord(value)) return undefined
    const out: Record<string, string> = {}
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === 'string') out[key] = entry
    }
    return survivors(out, Object.keys(value).length, Object.keys(out).length)
  }

  if ('array' in rule) {
    if (!Array.isArray(value)) return undefined
    const out = value
      .map((entry) => sanitizeValue(rule.array, entry))
      .filter((entry) => entry !== undefined)
    return survivors(out, value.length, out.length)
  }

  if ('objectMap' in rule) {
    if (!isRecord(value)) return undefined
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      const sanitized = sanitizeFields(rule.objectMap, entry)
      if (sanitized) out[key] = sanitized
    }
    return survivors(out, Object.keys(value).length, Object.keys(out).length)
  }

  return sanitizeFields(rule.object, value)
}

function sanitizeFields(fields: OptionSchema, value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, rule] of Object.entries(fields)) {
    if (!(key in value)) continue
    const sanitized = sanitizeValue(rule, value[key])
    if (sanitized !== undefined) out[key] = sanitized
  }
  return out
}

/**
 * Rebuild `options` from `schema`, key by key. An option nobody declared does
 * not survive, and a declared option whose value is the wrong shape is dropped
 * rather than coerced.
 */
export function sanitizeOptions(schema: OptionSchema, options: unknown): Record<string, unknown> {
  return sanitizeFields(schema, options) ?? {}
}
