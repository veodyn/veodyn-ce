import { describe, expect, it } from 'vitest'
import { hierarchy, type HierarchyNode } from 'd3-hierarchy'
import type { QueryResultData } from '@/lib/mock-data'
import { buildSunburstModel, type SunburstNode } from './sunburst-model'

const data: QueryResultData = {
  columns: [
    { name: 'region', friendly_name: 'region', type: 'string' },
    { name: 'city', friendly_name: 'city', type: 'string' },
    { name: 'value', friendly_name: 'value', type: 'integer' },
  ],
  rows: [
    { region: 'West', city: 'LA', value: 10 },
    { region: 'West', city: 'SF', value: 5 },
    { region: 'East', city: 'NYC', value: 8 },
  ],
}

// Small oracle-friendly lookups so assertions below read as plain equality
// checks instead of chained optional-access, and fail with a clear message
// (rather than "Cannot read properties of undefined") when a node is missing.
function findChild(node: SunburstNode, name: string): SunburstNode {
  const found = (node.children ?? []).find((c) => c.name === name)
  if (!found) throw new Error(`expected a child named "${name}" on "${node.name}"`)
  return found
}

function findHierarchyChild(node: HierarchyNode<SunburstNode>, name: string): HierarchyNode<SunburstNode> {
  const found = (node.children ?? []).find((c) => c.data.name === name)
  if (!found) throw new Error(`expected a hierarchy child named "${name}"`)
  return found
}

describe('buildSunburstModel', () => {
  describe('hierarchy shape', () => {
    it('nests non-value columns into a hierarchy with leaf values', () => {
      const root = buildSunburstModel({ valueColumn: 'value' }, data)
      expect(root.name).toBe('root')
      expect(root.children?.map((c) => c.name).sort()).toEqual(['East', 'West'])

      const west = findChild(root, 'West')
      expect(west.children?.map((c) => c.name).sort()).toEqual(['LA', 'SF'])
      expect(findChild(west, 'LA').value).toBe(10)
      expect(findChild(west, 'SF').value).toBe(5)

      const east = findChild(root, 'East')
      expect(east.children?.map((c) => c.name)).toEqual(['NYC'])
      expect(findChild(east, 'NYC').value).toBe(8)
    })

    it('leaves intermediate nodes without their own value, deferring rollup to d3-hierarchy', () => {
      const root = buildSunburstModel({ valueColumn: 'value' }, data)
      const west = findChild(root, 'West')
      // West is a depth-1 hierarchy node (region), not a leaf: it carries
      // children but no value of its own. Task 9 rolls values up the tree
      // via d3-hierarchy's .sum(), which only works if intermediate nodes
      // are left undefined here rather than pre-summed.
      expect(west.value).toBeUndefined()
      expect(root.value).toBeUndefined()
    })

    it('accumulates value when multiple rows share the same full hierarchy path', () => {
      const duplicatePaths: QueryResultData = {
        columns: data.columns,
        rows: [
          { region: 'West', city: 'LA', value: 10 },
          { region: 'West', city: 'LA', value: 4 },
        ],
      }
      const root = buildSunburstModel({ valueColumn: 'value' }, duplicatePaths)
      expect(root.children).toHaveLength(1)
      const west = findChild(root, 'West')
      expect(west.children).toEqual([{ name: 'LA', value: 14 }])
    })

    it('is a valid d3-hierarchy source whose parent sums equal the sum of their children (partition invariant)', () => {
      const root = buildSunburstModel({ valueColumn: 'value' }, data)
      const summed = hierarchy<SunburstNode>(root).sum((d) => d.value ?? 0)
      const west = findHierarchyChild(summed, 'West')
      const east = findHierarchyChild(summed, 'East')
      // West's rolled-up total equals the sum of its LA and SF leaves (10 + 5).
      expect(west.value).toBe(15)
      // East's rolled-up total equals its single NYC leaf.
      expect(east.value).toBe(8)
      // The root's rolled-up total equals the sum of its direct children,
      // which is the invariant d3-partition relies on to give each parent's
      // angular span the exact width of the sum of its children's spans.
      expect(summed.value).toBe(23)
    })
  })

  describe('valueColumn fallback', () => {
    it('uses the explicit options.valueColumn, even when a differently-purposed value column exists', () => {
      const withDecoy: QueryResultData = {
        columns: [
          { name: 'region', friendly_name: 'region', type: 'string' },
          { name: 'value', friendly_name: 'value', type: 'integer' },
          { name: 'count', friendly_name: 'count', type: 'integer' },
        ],
        rows: [{ region: 'West', value: 999, count: 3 }],
      }
      const root = buildSunburstModel({ valueColumn: 'count' }, withDecoy)
      // 'count' is the explicit value column, so 'value' becomes an ordinary
      // hierarchy level instead of being auto-detected as the value column.
      const west = findChild(root, 'West')
      expect(west.children).toEqual([{ name: '999', value: 3 }])
    })

    it("falls back to the column literally named 'value' when no option is given", () => {
      const root = buildSunburstModel({}, data)
      expect(root.name).toBe('root')
      const west = findChild(root, 'West')
      expect(findChild(west, 'LA').value).toBe(10)
    })

    it('falls back to the last column when neither an explicit option nor a value-named column exists', () => {
      const noValueColumn: QueryResultData = {
        columns: [
          { name: 'region', friendly_name: 'region', type: 'string' },
          { name: 'city', friendly_name: 'city', type: 'string' },
          { name: 'count', friendly_name: 'count', type: 'integer' },
        ],
        rows: [{ region: 'West', city: 'LA', count: 7 }],
      }
      const root = buildSunburstModel({}, noValueColumn)
      const west = findChild(root, 'West')
      expect(findChild(west, 'LA').value).toBe(7)
    })
  })

  describe('Redash sequence edge-list format', () => {
    // sequence/stage/node/value is Redash's SUNBURST_SEQUENCE edge-list
    // contract (upstream Redash viz-lib/src/visualizations/sunburst/initSunburst.ts,
    // isDataInHierarchyFormat): each row is one stage of one sequence, and
    // rows for the same sequence must chain into a single path, not become
    // separate sequence/stage/node branches.
    const sequenceData: QueryResultData = {
      columns: [
        { name: 'sequence', friendly_name: 'sequence', type: 'string' },
        { name: 'stage', friendly_name: 'stage', type: 'integer' },
        { name: 'node', friendly_name: 'node', type: 'string' },
        { name: 'value', friendly_name: 'value', type: 'integer' },
      ],
      rows: [
        { sequence: 's1', stage: 1, node: 'Landing', value: 12 },
        { sequence: 's1', stage: 2, node: 'Checkout', value: 12 },
      ],
    }

    it('chains rows for one sequence into a single node1 -> node2 path carrying the sequence value', () => {
      const root = buildSunburstModel({}, sequenceData)
      expect(root.children).toHaveLength(1)
      const landing = findChild(root, 'Landing')
      expect(landing.value).toBeUndefined()
      expect(landing.children).toHaveLength(1)
      const checkout = findChild(landing, 'Checkout')
      expect(checkout.value).toBe(12)
    })

    it('does not double-count the sequence into three separate sequence/stage/node branches', () => {
      const root = buildSunburstModel({}, sequenceData)
      expect(root.children?.map((c) => c.name)).toEqual(['Landing'])
      expect(root.children?.some((c) => c.name === 's1')).toBe(false)
      expect(root.children?.some((c) => c.name === '1')).toBe(false)
    })

    it('orders the node path by stage, even when rows arrive out of order', () => {
      const outOfOrder: QueryResultData = {
        columns: sequenceData.columns,
        rows: [
          { sequence: 's1', stage: 2, node: 'Checkout', value: 5 },
          { sequence: 's1', stage: 1, node: 'Landing', value: 5 },
        ],
      }
      const root = buildSunburstModel({}, outOfOrder)
      const landing = findChild(root, 'Landing')
      expect(findChild(landing, 'Checkout').value).toBe(5)
    })

    it('sums independent sequences that share a full path onto the same leaf', () => {
      const twoSequences: QueryResultData = {
        columns: sequenceData.columns,
        rows: [
          { sequence: 's1', stage: 1, node: 'Landing', value: 12 },
          { sequence: 's1', stage: 2, node: 'Checkout', value: 12 },
          { sequence: 's2', stage: 1, node: 'Landing', value: 8 },
          { sequence: 's2', stage: 2, node: 'Checkout', value: 8 },
        ],
      }
      const root = buildSunburstModel({}, twoSequences)
      expect(root.children).toHaveLength(1)
      const landing = findChild(root, 'Landing')
      expect(findChild(landing, 'Checkout').value).toBe(20)
    })

    it('keeps sequences that diverge after a shared prefix as separate branches', () => {
      const divergent: QueryResultData = {
        columns: sequenceData.columns,
        rows: [
          { sequence: 's1', stage: 1, node: 'Landing', value: 12 },
          { sequence: 's1', stage: 2, node: 'Checkout', value: 12 },
          { sequence: 's2', stage: 1, node: 'Landing', value: 3 },
          { sequence: 's2', stage: 2, node: 'Exit', value: 3 },
        ],
      }
      const root = buildSunburstModel({}, divergent)
      const landing = findChild(root, 'Landing')
      expect(landing.children?.map((c) => c.name).sort()).toEqual(['Checkout', 'Exit'])
    })
  })

  describe('graceful degradation', () => {
    it('returns a childless root when there are no rows', () => {
      const root = buildSunburstModel({ valueColumn: 'value' }, { columns: data.columns, rows: [] })
      expect(root).toEqual({ name: 'root', children: [] })
    })

    it('does not throw and returns a childless root when there are no columns and no rows at all', () => {
      expect(() => buildSunburstModel({}, { columns: [], rows: [] })).not.toThrow()
      const root = buildSunburstModel({}, { columns: [], rows: [] })
      expect(root).toEqual({ name: 'root', children: [] })
    })

    it('does not throw when every column resolves to the value column, degrading to a flat root total', () => {
      const flat: QueryResultData = {
        columns: [{ name: 'value', friendly_name: 'value', type: 'integer' }],
        rows: [{ value: 3 }, { value: 4 }],
      }
      expect(() => buildSunburstModel({}, flat)).not.toThrow()
      const root = buildSunburstModel({}, flat)
      expect(root.children).toEqual([])
      expect(root.value).toBe(7)
    })
  })
})
