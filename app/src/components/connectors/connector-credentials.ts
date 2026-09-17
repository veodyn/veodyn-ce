import type { FormField } from '@/components/forms/dynamic-form'

export type CredentialAction = 'keep' | 'replace' | 'clear'

export interface CredentialEdit {
  action: CredentialAction
  value: unknown
}

export type CredentialEdits = Record<string, CredentialEdit>

export interface ConnectorEditBody {
  replace: Record<string, unknown>
  clear: string[]
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true
  return typeof value === 'string' && value.trim() === ''
}

function emptyRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>
}

export function credentialsToSend(
  fields: FormField[],
  values: Record<string, unknown>
): Record<string, unknown> {
  const credentials = emptyRecord<unknown>()
  for (const field of fields) {
    const value = values[field.name] ?? field.default
    if (isBlank(value)) continue
    credentials[field.name] = field.type === 'number' ? Number(value) : value
  }
  return credentials
}

export function missingCredentialMessage(
  fields: FormField[],
  credentials: Record<string, unknown>,
  alreadyConfigured: string[] = []
): string | null {
  const missing = fields.filter(
    (field) => field.required && !(field.name in credentials) && !alreadyConfigured.includes(field.name)
  )
  if (missing.length === 0) return null
  return `Fill in the required ${missing.length === 1 ? 'field' : 'fields'}: ${missing
    .map((field) => field.title)
    .join(', ')}.`
}

export function defaultAction(field: FormField, configuredFields: string[]): CredentialAction {
  if (configuredFields.includes(field.name)) return 'keep'
  return field.required ? 'replace' : 'keep'
}

export function blankValueFor(field: FormField): unknown {
  return field.type === 'boolean' ? false : ''
}

export function editsForConnector(fields: FormField[], configuredFields: string[]): CredentialEdits {
  const edits = emptyRecord<CredentialEdit>()
  for (const field of fields) {
    edits[field.name] = { action: defaultAction(field, configuredFields), value: blankValueFor(field) }
  }
  return edits
}

function isBlankReplacement(field: FormField, edit: CredentialEdit | undefined): boolean {
  if (edit === undefined) return true
  if (field.type === 'boolean') return false
  return isBlank(edit.value)
}

function supplies(field: FormField, edit: CredentialEdit | undefined): boolean {
  return edit?.action === 'replace' && !isBlankReplacement(field, edit)
}

export function editBody(fields: FormField[], edits: CredentialEdits): ConnectorEditBody {
  const replace = emptyRecord<unknown>()
  const clear: string[] = []
  for (const field of fields) {
    const edit = edits[field.name]
    if (edit === undefined || edit.action === 'keep') continue
    if (edit.action === 'clear') {
      clear.push(field.name)
      continue
    }
    replace[field.name] = field.type === 'number' ? Number(edit.value) : edit.value
  }
  return { replace, clear }
}

export function editProblem(
  fields: FormField[],
  edits: CredentialEdits,
  configuredFields: string[]
): string | null {
  const missing = fields.filter(
    (field) =>
      field.required && !configuredFields.includes(field.name) && !supplies(field, edits[field.name])
  )
  if (missing.length > 0) {
    return `Fill in the required ${missing.length === 1 ? 'field' : 'fields'}: ${missing
      .map((field) => field.title)
      .join(', ')}.`
  }
  const unfilled = fields.filter(
    (field) =>
      edits[field.name]?.action === 'replace' && isBlankReplacement(field, edits[field.name])
  )
  if (unfilled.length === 0) return null
  return `Type the new value for the ${unfilled.length === 1 ? 'field' : 'fields'} set to Replace, or set ${
    unfilled.length === 1 ? 'it' : 'them'
  } back to Keep: ${unfilled.map((field) => field.title).join(', ')}.`
}
