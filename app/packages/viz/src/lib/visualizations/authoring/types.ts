import type { OptionRule } from '../option-schema'

export type AuthoringColumnKind = 'one' | 'list' | 'mapKeys' | 'listOfObjectsByName'

export type AuthoringField = {
  rule: OptionRule
  description: string
  enum?: readonly string[]
  column?: AuthoringColumnKind
  default?: unknown
  appliesTo?: { key: string; equals: unknown }
}

export type AuthoringSchema = Record<string, AuthoringField>

export const UNUSED_COLUMN = '-- unused --'
