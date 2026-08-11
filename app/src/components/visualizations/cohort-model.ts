import type { QueryResultData } from '@/lib/mock-data'
import type { RedashCohortOptions } from '@/services/redash/types'

export interface CohortRow {
  key: string
  total: number
  values: (number | null)[]
}

export interface CohortModel {
  rows: CohortRow[]
  stages: number[]
}

const EMPTY: CohortModel = { rows: [], stages: [] }

// Pure pivot: no React, no fetch. Groups rows by the cohort key (dateColumn)
// into a retention grid indexed by stage (stageColumn), one cell per
// (cohort, stage) holding valueColumn or null when the pair has no row. The
// stage axis is the OBSERVED contiguous range (min..max stage seen in the
// data), matching Redash's Cornelius grid, which iterates real stage numbers
// rather than assuming they start at 0. The moment-based diagonal
// gap-filling stock Redash applies for mode: 'diagonal' is a documented seam,
// deferred per the plan's scope boundaries (see RedashCohortOptions in
// src/services/redash/types.ts).
export function buildCohortModel(options: RedashCohortOptions, data: QueryResultData): CohortModel {
  const { dateColumn, stageColumn, totalColumn, valueColumn } = options
  if (!dateColumn || !stageColumn || !totalColumn || !valueColumn) return EMPTY

  const groups = new Map<string, { total: number; stageValues: Map<number, number> }>()
  let minStage = Infinity
  let maxStage = -Infinity

  for (const row of data.rows) {
    const key = String(row[dateColumn])
    const stage = Number(row[stageColumn])
    if (!Number.isFinite(stage)) continue
    const value = Number(row[valueColumn])
    const total = Number(row[totalColumn])
    const group = groups.get(key) ?? { total: Number.isFinite(total) ? total : 0, stageValues: new Map() }
    if (Number.isFinite(value)) group.stageValues.set(stage, value)
    if (Number.isFinite(total)) group.total = total
    groups.set(key, group)
    if (stage < minStage) minStage = stage
    if (stage > maxStage) maxStage = stage
  }

  if (!Number.isFinite(minStage) || !Number.isFinite(maxStage)) return EMPTY

  const stages: number[] = []
  for (let stage = minStage; stage <= maxStage; stage += 1) stages.push(stage)

  const rows: CohortRow[] = Array.from(groups.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, group]) => {
      const values = stages.map((stage) => group.stageValues.get(stage) ?? null)
      return { key, total: group.total, values }
    })

  return { rows, stages }
}
