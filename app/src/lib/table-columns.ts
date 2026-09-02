import type { QueryResultColumn } from '@/lib/mock-data'
import type { RedashTableColumnOptions } from '@/services/redash/types'

export function effectiveColumnConfig(
  sourceColumns: QueryResultColumn[],
  config?: RedashTableColumnOptions[]
): RedashTableColumnOptions[] {
  const configByName = new Map((config ?? []).map((c) => [c.name, c]))
  return sourceColumns
    .map((col, i) => configByName.get(col.name) ?? { name: col.name, visible: true, order: i })
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

export function renumberColumnConfig(config: RedashTableColumnOptions[]): RedashTableColumnOptions[] {
  return config.map((c, i) => ({ ...c, order: i }))
}

export function reorderColumns(
  sourceColumns: QueryResultColumn[],
  config: RedashTableColumnOptions[] | undefined,
  movedName: string,
  targetName: string
): RedashTableColumnOptions[] {
  const current = effectiveColumnConfig(sourceColumns, config)
  const from = current.findIndex((c) => c.name === movedName)
  const to = current.findIndex((c) => c.name === targetName)
  if (from === -1 || to === -1 || from === to) return renumberColumnConfig(current)
  const next = [...current]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return renumberColumnConfig(next)
}
