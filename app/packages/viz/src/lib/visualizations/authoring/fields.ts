import type { AuthoringField } from './types'

type Extra = Partial<Pick<AuthoringField, 'default' | 'appliesTo'>>

export function columnOne(description: string, extra: Extra = {}): AuthoringField {
  return { rule: 'string', description, column: 'one', ...extra }
}

export function roleMapping(description: string, roles: readonly string[]): AuthoringField {
  return { rule: { stringMap: true }, description, enum: roles, column: 'mapKeys' }
}

export function text(description: string, extra: Extra = {}): AuthoringField {
  return { rule: 'string', description, ...extra }
}

export function choice(description: string, values: readonly string[], extra: Extra = {}): AuthoringField {
  return { rule: 'string', description, enum: values, ...extra }
}

export function count(description: string, extra: Extra = {}): AuthoringField {
  return { rule: 'number', description, ...extra }
}

export function flag(description: string, extra: Extra = {}): AuthoringField {
  return { rule: 'boolean', description, ...extra }
}
