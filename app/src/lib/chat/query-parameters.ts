export type ParameterQuote = 'none' | 'single' | 'double'

export type ChatParameterDefinition = {
  name: string
  type: string
  title?: string
  value?: unknown
  enumOptions?: string
  queryId?: number
  multi?: boolean
  quote?: ParameterQuote
}

type Definition = Record<string, unknown>

const QUOTE_CHARACTER: Record<ParameterQuote, string> = { none: '', single: "'", double: '"' }
const MODEL_KEYS = ['name', 'title', 'type', 'value', 'enumOptions', 'queryId'] as const
const SEPARATOR = ','

function record(value: unknown): Definition {
  return value !== null && typeof value === 'object' ? (value as Definition) : {}
}

function quoteOf(prefix: unknown): ParameterQuote {
  if (prefix === "'") return 'single'
  if (prefix === '"') return 'double'
  return 'none'
}

export function toModelParameter(native: Definition): Definition {
  const definition: Definition = {}
  for (const key of MODEL_KEYS) {
    if (native[key] !== undefined && native[key] !== null) definition[key] = native[key]
  }
  const multi = record(native.multiValuesOptions)
  if (native.multiValuesOptions && Object.keys(multi).length > 0) {
    definition.multi = true
    definition.quote = quoteOf(multi.prefix)
  }
  return definition
}

const MODEL_EXPRESSIBLE = new Set<string>([...MODEL_KEYS, 'multi', 'quote', 'multiValuesOptions'])

function nativeOnly(current: Definition | undefined): Definition {
  return Object.fromEntries(Object.entries(current ?? {}).filter(([key]) => !MODEL_EXPRESSIBLE.has(key)))
}

export function toNativeParameter(definition: Definition, current?: Definition): Definition {
  const { multi, quote, ...rest } = definition
  const native: Definition = { ...nativeOnly(current), ...rest }
  if (multi === undefined && rest.multiValuesOptions === undefined && current?.multiValuesOptions !== undefined) {
    native.multiValuesOptions = current.multiValuesOptions
  }
  if (multi === true) {
    const character = QUOTE_CHARACTER[(quote as ParameterQuote | undefined) ?? 'none'] ?? ''
    native.multiValuesOptions = { prefix: character, suffix: character, separator: SEPARATOR }
  }
  return native
}

export function toNativeParameters(definitions: Definition[], current: Definition[] = []): Definition[] {
  const byName = new Map(current.map((one) => [String(one.name), one]))
  return definitions.map((one) => toNativeParameter(one, byName.get(String(one.name))))
}
