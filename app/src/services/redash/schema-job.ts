const SCHEMA_NOT_SUPPORTED = 1

export type SchemaJobError = string | { code?: number; message?: string } | null | undefined

export function isSchemaNotSupported(error: SchemaJobError): boolean {
  return typeof error === 'object' && error !== null && error.code === SCHEMA_NOT_SUPPORTED
}

export function schemaJobMessage(error: SchemaJobError): string {
  if (typeof error === 'string') return error
  return error?.message ?? ''
}
