'use client'

import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import type { RedashCounterOptions } from '@/services/redash/types'
import { formatAutoDetectNumber } from '@/lib/chart-format'
import { getVisualization } from '@/lib/visualizations'
import { SingleValue } from './single-value'

/**
 * The visualization's name, unless it is the one Redash gave it for free.
 *
 * Redash names every new visualization after its type, so an unnamed counter is
 * literally called "Counter". A counter has room for exactly one line of text
 * under its number, which makes it the worst possible place for a type name to
 * surface: "Current Weather" on a dashboard read `86.56` over the word
 * `Counter`, with no unit, so the reader could not tell degrees from humidity.
 *
 * This is the rule Redash applies to itself. `VisualizationName.jsx` in the
 * fork renders `visualization.name !== config.name ? name : null`, treating a
 * name equal to the registered type's own as no name at all.
 */
function authoredName(visualization: MockVisualization): string {
  const typeDefault = getVisualization(visualization.type)?.displayName
  const name = visualization.name?.trim() ?? ''
  return name && name !== typeDefault ? name : ''
}

interface CounterRendererProps {
  visualization: MockVisualization
  data: QueryResultData
}

export function CounterRenderer({ visualization, data }: CounterRendererProps) {
  const options = (visualization.options ?? {}) as RedashCounterOptions
  const colName = options.counterColName || data.columns[0]?.name
  // The column name last, because it says what the number IS. A counter over
  // `temperature_f` captioned with its column beats one captioned "Counter",
  // and beats one captioned nothing.
  const label = options.counterLabel || authoredName(visualization) || colName
  const rowNum = (options.rowNumber || 1) - 1
  const countRow = options.countRow === true

  if (!countRow && !colName) return null

  const value = countRow ? data.rows.length : data.rows[rowNum]?.[colName as string]

  // targetColName (same-row, different column) takes precedence over the
  // legacy targetRowNumber (different row, same column) when both are set.
  // Row-count mode has no meaningful cell target, so no trend is shown.
  const targetValue = countRow
    ? null
    : options.targetColName
      ? data.rows[rowNum]?.[options.targetColName]
      : options.targetRowNumber != null
        ? data.rows[options.targetRowNumber - 1]?.[colName as string]
        : null

  const formatOptions = {
    prefix: options.stringPrefix,
    suffix: options.stringSuffix,
    decimals: options.stringDecimal,
  }

  const formattedValue = formatAutoDetectNumber(value, formatOptions)

  let trend: 'up' | 'down' | null = null
  if (targetValue != null && value != null) {
    trend = Number(value) >= Number(targetValue) ? 'up' : 'down'
  }

  return (
    <SingleValue
      value={formattedValue}
      label={label}
      trend={
        trend && (
          <span className={trend === 'up' ? 'text-status-fresh' : 'text-status-stale'}>
            {trend === 'up' ? '▲' : '▼'} vs {formatAutoDetectNumber(targetValue, formatOptions)}
          </span>
        )
      }
    />
  )
}
