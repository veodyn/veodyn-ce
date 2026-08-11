import type { QueryResultData } from '@/lib/mock-data'
import type { RedashSunburstOptions } from '@/services/redash/types'

export interface SunburstNode {
  name: string
  value?: number
  children?: SunburstNode[]
}

// A single hierarchy path with the size that should land on its leaf. Both
// supported source shapes (Redash's sequence edge-list and the generalized
// column-nesting table) reduce to a list of these before the tree is built,
// so the tree-building walk only has to be written once.
interface TreeEntry {
  levels: string[]
  size: number
}

// Builds (and accumulates into) a nested tree of the same shape d3-hierarchy
// expects: a synthetic 'root', with intermediate nodes left valueless so
// Task 9's hierarchy().sum() can roll leaf values up to their ancestors.
// Multiple entries sharing the same full path accumulate onto the same leaf.
function buildTree(entries: TreeEntry[]): SunburstNode {
  const root: SunburstNode = { name: 'root', children: [] }

  for (const { levels, size } of entries) {
    let current = root
    for (const label of levels) {
      current.children = current.children ?? []
      let child = current.children.find((c) => c.name === label)
      if (!child) {
        child = { name: label }
        current.children.push(child)
      }
      current = child
    }
    current.value = (current.value ?? 0) + size
  }

  return root
}

// Redash's SUNBURST_SEQUENCE detects the edge-list shape purely from column
// names, the same way viz-lib's initSunburst does (isDataInHierarchyFormat):
// every row carries all four of these fields.
const SEQUENCE_FIELDS = ['sequence', 'stage', 'node', 'value'] as const

function isSequenceFormat(data: QueryResultData): boolean {
  const columnNames = new Set(data.columns.map((c) => c.name))
  return SEQUENCE_FIELDS.every((field) => columnNames.has(field))
}

// Edge-list format: rows are grouped by sequence id, ordered by stage within
// each sequence, and chained into a node path (node1 -> node2 -> ...). The
// sequence's value is carried by every row in the group (Redash's exporters
// repeat it per stage), so the leaf size is read from the first row
// encountered for that sequence rather than summed across the group, which
// would double-count a single sequence's occurrences across its own stages.
function buildSequenceEntries(rows: Record<string, unknown>[]): TreeEntry[] {
  const groups = new Map<string, Record<string, unknown>[]>()
  for (const row of rows) {
    const key = String(row.sequence)
    const group = groups.get(key)
    if (group) {
      group.push(row)
    } else {
      groups.set(key, [row])
    }
  }

  return Array.from(groups.values()).map((group) => {
    const sorted = [...group].sort((a, b) => Number(a.stage) - Number(b.stage))
    return {
      levels: sorted.map((row) => String(row.node ?? '')),
      size: Number(group[0]?.value) || 0,
    }
  })
}

// Generalized nesting fallback: every column except the resolved value
// column becomes a hierarchy level, in column order, and the value column is
// the leaf size. This is the shape existing (non-sequence) fixtures rely on.
function buildTableEntries(options: RedashSunburstOptions, data: QueryResultData): TreeEntry[] {
  const valueColumn =
    options.valueColumn ?? data.columns.find((c) => c.name === 'value')?.name ?? data.columns.at(-1)?.name
  const levelColumns = data.columns.map((c) => c.name).filter((name) => name !== valueColumn)

  return data.rows.map((row) => ({
    levels: levelColumns.map((column) => String(row[column] ?? '')).filter((label) => label !== ''),
    size: Number(row[valueColumn ?? '']) || 0,
  }))
}

export function buildSunburstModel(options: RedashSunburstOptions, data: QueryResultData): SunburstNode {
  const entries = isSequenceFormat(data) ? buildSequenceEntries(data.rows) : buildTableEntries(options, data)
  return buildTree(entries)
}
