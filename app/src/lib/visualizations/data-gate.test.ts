import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { QueryResultData } from '@/lib/mock-data'
import {
  EMPTY_QUERY_RESULT,
  needsQueryResult,
  PLUGIN_API_VERSION,
  registerVisualization,
  visualizationData,
} from '@/lib/visualizations'

const withRows: QueryResultData = {
  columns: [{ name: 'bikes', friendly_name: 'Bikes', type: 'integer' }],
  rows: [{ bikes: 7 }],
}
const noRows: QueryResultData = { columns: withRows.columns, rows: [] }

// Registered once, at module scope, because every case below needs it and the
// registry throws on a duplicate type.
registerVisualization({
  apiVersion: PLUGIN_API_VERSION,
  type: 'TEST_DATALESS',
  displayName: 'Dataless',
  icon: () => null,
  defaultOptions: {},
  Renderer: () => null,
  needs: 'none',
})

describe('needsQueryResult', () => {
  it('is true for a core type, which is a view of its query rows', () => {
    expect(needsQueryResult('CHART')).toBe(true)
    expect(needsQueryResult('TABLE')).toBe(true)
  })

  it('is false for a type that declares it draws from something else', () => {
    expect(needsQueryResult('TEST_DATALESS')).toBe(false)
  })

  // The conservative direction. A lookup that misses must not mount an unknown
  // type against nothing on the strength of the miss.
  it('is true for a type this build does not have', () => {
    expect(needsQueryResult('NOT_REGISTERED')).toBe(true)
  })
})

describe('visualizationData', () => {
  describe('a type that needs its query result', () => {
    it('gets the result when there is one', () => {
      expect(visualizationData('CHART', withRows)).toBe(withRows)
    })

    it('gets null when there is none, so the surface shows its empty state', () => {
      expect(visualizationData('CHART', null)).toBeNull()
      expect(visualizationData('CHART', undefined)).toBeNull()
    })

    it('keeps an empty result unless the surface asked for rows', () => {
      expect(visualizationData('CHART', noRows)).toBe(noRows)
      expect(visualizationData('CHART', noRows, { requireRows: true })).toBeNull()
    })
  })

  describe('a type that does not', () => {
    // The point of the whole change: every one of these used to be null on at
    // least one surface, which is a widget that can never draw.
    it('gets an empty result rather than null when there is none', () => {
      expect(visualizationData('TEST_DATALESS', null)).toBe(EMPTY_QUERY_RESULT)
      expect(visualizationData('TEST_DATALESS', undefined)).toBe(EMPTY_QUERY_RESULT)
    })

    it('is not withheld by requireRows', () => {
      expect(visualizationData('TEST_DATALESS', noRows, { requireRows: true })).toBe(noRows)
      expect(visualizationData('TEST_DATALESS', null, { requireRows: true })).toBe(
        EMPTY_QUERY_RESULT
      )
    })

    it('still gets a real result when one exists, in case it wants it', () => {
      expect(visualizationData('TEST_DATALESS', withRows)).toBe(withRows)
    })
  })
})

// One object is shared by every dataless widget on the page. A renderer that
// pushed a row into it would corrupt the others, and the symptom would appear
// in a widget nobody had touched.
describe('EMPTY_QUERY_RESULT', () => {
  it('cannot be written through', () => {
    expect(Object.isFrozen(EMPTY_QUERY_RESULT)).toBe(true)
    expect(Object.isFrozen(EMPTY_QUERY_RESULT.rows)).toBe(true)
    expect(Object.isFrozen(EMPTY_QUERY_RESULT.columns)).toBe(true)
  })
})

// The gate is only worth having if every surface asks it. This finds the
// surfaces rather than listing them, for the reason the plugin import boundary
// learned the hard way: a hand-written list covers what its author remembered,
// and a seventh surface added later would sit outside it silently.
describe('every surface that mounts a visualization asks the gate', () => {
  const ROOT = process.cwd()

  function walk(dir: string): string[] {
    const found: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) found.push(...walk(full))
      else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) found.push(full)
    }
    return found
  }

  const MOUNT_SITES = walk(join(ROOT, 'src'))
    .filter((file) => readFileSync(file, 'utf8').includes('<VisualizationRenderer'))
    .map((file) => relative(ROOT, file).split(sep).join('/'))
    .sort()

  // Both resolve their data elsewhere, and both are asserted below to still be
  // mount sites, so a rename cannot leave a stale exemption behind that quietly
  // excuses a file which has since grown its own lookup.
  const RESOLVED_ELSEWHERE = [
    // Takes an already-resolved result as a required prop; visualization-widget
    // runs the gate before mounting it.
    'src/components/dashboard/expanded-widget-dialog.tsx',
    // The public payload is a stored snapshot that always carries its result,
    // so there is no "no result" branch here to relax.
    'src/app/embed/public/[token]/page.tsx',
  ]

  // Without this the filter below passes vacuously over an empty list, which is
  // exactly how a guard goes blind.
  //
  // Six is what a build with no feature packages holds, and it is a floor
  // rather than an equality: a build that installs feature packages mounts
  // visualizations on their surfaces too, and asserts those in its own suite.
  // Lowering this number to match a tree that has lost a surface would be the
  // defect, so it moves only when a community surface is deliberately added or
  // removed.
  const MINIMUM_MOUNT_SITES = 6

  it('finds the surfaces it is checking', () => {
    expect(MOUNT_SITES.length).toBeGreaterThanOrEqual(MINIMUM_MOUNT_SITES)
  })

  it.each(RESOLVED_ELSEWHERE)('still has %s to exempt', (file) => {
    expect(MOUNT_SITES).toContain(file)
  })

  it('has no surface deciding for itself whether a visualization may draw', () => {
    const deciding = MOUNT_SITES.filter(
      (file) =>
        !RESOLVED_ELSEWHERE.includes(file) && !readFileSync(join(ROOT, file), 'utf8').includes('visualizationData')
    )

    expect(deciding).toEqual([])
  })
})
