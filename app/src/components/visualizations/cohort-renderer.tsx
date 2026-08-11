'use client'

import { useMemo } from 'react'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import type { RedashCohortOptions } from '@/services/redash/types'
import { formatCompactNumber } from '@/lib/chart-format'
import { getSequentialScale } from '@/lib/chart-colors'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { buildCohortModel } from './cohort-model'

interface CohortRendererProps {
  visualization: MockVisualization
  data: QueryResultData
}

// Fixed 0..100 domain, matching Redash's Cornelius grid: every cell shows a
// retention percentage of its own cohort's total, so two cohorts retaining
// the same share get the same color no matter how large either cohort was.
const colorForPct = getSequentialScale(0, 100)

// The one string a cell's accessible name and its tooltip are both built from,
// so a hover-only copy and a screen-reader-only copy of the same numbers
// cannot drift. Same shape as describeHeatmapCell, the other grid of coloured
// cells in this directory.
function describeCohortCell(key: string, stage: number, value: number | null, pct: number | null): string {
  if (pct == null || value == null) return `${key} / period ${stage}: no data`
  return `${key} / period ${stage}: ${value} (${Math.round(pct)}%)`
}

export function CohortRenderer({ visualization, data }: CohortRendererProps) {
  const options = useMemo(() => (visualization.options ?? {}) as RedashCohortOptions, [visualization.options])
  const model = useMemo(() => buildCohortModel(options, data), [options, data])

  if (model.rows.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">Cohort requires cohort, period, and value columns.</div>
  }

  return (
    <div className="p-4 overflow-auto">
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `auto auto repeat(${model.stages.length}, minmax(2.5rem, 1fr))` }}
      >
        <div className="text-xs text-muted-foreground px-2 py-1">Cohort</div>
        <div className="text-xs text-muted-foreground px-2 py-1 text-right">Total</div>
        {model.stages.map((stage) => (
          <div key={stage} className="text-xs text-muted-foreground text-center px-1 py-1">
            {stage}
          </div>
        ))}
        {model.rows.map((row) => (
          <div key={row.key} className="contents">
            {/* The tooltip here reveals a key the column has truncated, which
                is the one job the native title attribute was doing that is
                worth keeping. Not an accessible-name problem: the full key is
                already this element's text. */}
            <Tooltip>
              <TooltipTrigger render={<div className="text-xs text-foreground px-2 py-1 truncate" />}>
                {row.key}
              </TooltipTrigger>
              <TooltipContent>{row.key}</TooltipContent>
            </Tooltip>
            <div className="text-xs text-muted-foreground px-2 py-1 text-right tabular-nums">
              {formatCompactNumber(row.total)}
            </div>
            {row.values.map((value, i) => {
              const stage = model.stages[i]
              const pct = row.total > 0 && value != null ? (value / row.total) * 100 : null
              const description = describeCohortCell(row.key, stage, value, pct)
              return (
                // role="img" is what lets aria-label name the cell at all (a
                // plain div is generic, where aria-label is ignored), and the
                // name carries the cohort, the period and the raw count, none
                // of which the "40%" the cell paints can say on its own.
                // Deliberately not focusable, unlike the box plot's handful of
                // columns: a retention grid is cohorts times periods, and a tab
                // stop per cell would bury the rest of the page behind
                // hundreds of them. Nothing is keyboard-only here, because the
                // accessible name already carries everything the tooltip says.
                <Tooltip key={stage}>
                  <TooltipTrigger
                    render={
                      <div
                        role="img"
                        aria-label={description}
                        className="aspect-square min-h-8 rounded-sm flex items-center justify-center text-[10px] font-medium tabular-nums"
                        style={{ backgroundColor: pct != null ? colorForPct(pct) : 'var(--muted)' }}
                      />
                    }
                  >
                    {pct != null ? `${Math.round(pct)}%` : ''}
                  </TooltipTrigger>
                  <TooltipContent>{description}</TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
