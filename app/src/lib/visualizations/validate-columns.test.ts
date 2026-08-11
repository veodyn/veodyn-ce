import { describe, expect, it } from 'vitest'
import type { QueryResultData } from '@/lib/mock-data'
import { missingMappedColumns, missingNamedColumns } from './validate-columns'

const data: QueryResultData = {
  columns: [
    { name: 'name', friendly_name: 'name', type: 'string' },
    { name: 'num_bikes_available', friendly_name: 'num_bikes_available', type: 'integer' },
  ],
  rows: [{ name: 'a', num_bikes_available: 1 }],
}

describe('missingNamedColumns', () => {
  const keys = [
    { key: 'latColName', label: 'latitude' },
    { key: 'lonColName', label: 'longitude' },
  ]

  it('reports a column the result does not have', () => {
    expect(missingNamedColumns({ latColName: 'lat' }, keys, data)).toEqual([
      'The latitude column "lat" is not in this query result.',
    ])
  })

  it('says nothing about a column that exists', () => {
    expect(missingNamedColumns({ latColName: 'name' }, keys, data)).toEqual([])
  })

  // A freshly created visualization has nothing configured yet. Reporting that
  // as an error would flag every new visualization the moment it is made.
  it('treats unset and empty as unconfigured rather than broken', () => {
    expect(missingNamedColumns({}, keys, data)).toEqual([])
    expect(missingNamedColumns({ latColName: '' }, keys, data)).toEqual([])
  })

  it('reports each bad key separately', () => {
    expect(missingNamedColumns({ latColName: 'a', lonColName: 'b' }, keys, data)).toHaveLength(2)
  })
})

describe('missingMappedColumns', () => {
  // The regression this exists for: a chart mapping `capacity` to y after the
  // data source stopped returning that column drew axes and no bars.
  it('reports a mapped column the result does not have', () => {
    expect(missingMappedColumns({ columnMapping: { capacity: 'y' } }, data)).toEqual([
      'The y column "capacity" is not in this query result.',
    ])
  })

  it('says nothing about a mapping that resolves', () => {
    expect(
      missingMappedColumns({ columnMapping: { name: 'x', num_bikes_available: 'y' } }, data)
    ).toEqual([])
  })

  // Editors park an unwanted column under a non-role value rather than
  // deleting the entry, and a parked column is allowed to be stale.
  it('ignores entries that do not carry a real role', () => {
    expect(missingMappedColumns({ columnMapping: { gone: 'unused' } }, data)).toEqual([])
  })

  // The role set has to match what the renderers actually read, in both
  // directions. sankey-renderer.tsx reads source and target, and they were
  // missing, so a Sankey whose source column disappeared reported nothing.
  it('reports a missing sankey source or target', () => {
    expect(missingMappedColumns({ columnMapping: { old_origin: 'source' } }, data)).toEqual([
      'The source column "old_origin" is not in this query result.',
    ])
    expect(missingMappedColumns({ columnMapping: { old_dest: 'target' } }, data)).toHaveLength(1)
  })

  // `size` has been on both sides of that. It was dropped from the role set
  // while nothing read it, because warning about a column the visualization
  // already ignored was a false alarm. ScatterChart binds it to a ZAxis now, so
  // a stale one costs a bubble its third dimension: every mark falls back to
  // one size and the chart draws as the plain scatter it is not.
  it('reports a stale bubble size column now that a renderer reads it', () => {
    expect(missingMappedColumns({ columnMapping: { old_weight: 'size' } }, data)).toEqual([
      'The size column "old_weight" is not in this query result.',
    ])
  })

  // And the false alarm stays retired: a size column that resolves is a working
  // bubble, not a finding.
  it('says nothing about a size column the result still has', () => {
    expect(
      missingMappedColumns({ columnMapping: { name: 'x', num_bikes_available: 'size' } }, data)
    ).toEqual([])
  })

  it('tolerates a missing or malformed mapping', () => {
    expect(missingMappedColumns({}, data)).toEqual([])
    expect(missingMappedColumns({ columnMapping: 'nonsense' }, data)).toEqual([])
  })
})
