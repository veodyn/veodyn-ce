import type { OptionRule } from '../option-schema'
import { getVisualization, authoringFor } from '../registry'
import { CORE_LABELS } from './core-authoring'
import type { AuthoringField, AuthoringColumnKind } from './types'

export type DescribedOption = {
  key: string
  rule: string
  enum?: string[]
  description: string
  column?: AuthoringColumnKind
  default?: unknown
}

export type DescribedType = {
  type: string
  label: string
  options: DescribedOption[]
}

function renderFields(fields: Record<string, OptionRule>): string {
  return `object {${Object.entries(fields)
    .map(([key, rule]) => `${key}: ${renderRule(rule)}`)
    .join(', ')}}`
}

function renderRule(rule: OptionRule, field?: AuthoringField): string {
  if (typeof rule === 'string') return rule
  if ('stringMap' in rule) {
    return field?.column === 'mapKeys' && field.enum ? `map of column to ${field.enum.join('|')}` : 'map of string to string'
  }
  if ('array' in rule) return `list of ${renderRule(rule.array)}`
  if ('objectMap' in rule) return `map of name to ${renderFields(rule.objectMap)}`
  return renderFields(rule.object)
}

function describeField(key: string, field: AuthoringField): DescribedOption {
  const described: DescribedOption = {
    key,
    rule: renderRule(field.rule, field),
    description: field.description,
  }
  if (field.enum && field.rule === 'string') described.enum = [...field.enum]
  if (field.column) described.column = field.column
  if (field.default !== undefined) described.default = field.default
  return described
}

export function describeAuthoring(type: string): DescribedType | null {
  const schema = authoringFor(type)
  if (!schema) return null
  return {
    type,
    label: getVisualization(type)?.displayName ?? CORE_LABELS[type] ?? type,
    options: Object.entries(schema).map(([key, field]) => describeField(key, field)),
  }
}
