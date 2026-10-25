import type { SchemaTable } from '@/lib/mock-data'
import type { RedashSchemaTableRaw } from './types'

export function mapSchemaTable(raw: RedashSchemaTableRaw): SchemaTable {
  return {
    name: raw.name,
    columns: (raw.columns || []).map((col) =>
      typeof col === 'string' ? { name: col, type: '' } : { name: col.name, type: col.type || '' }
    ),
  }
}
