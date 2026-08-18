'use client'

import { useMemo } from 'react'
import { ResponsiveContainer, Sankey, Tooltip } from 'recharts'
import type { TooltipContentProps } from 'recharts'
import type { NodeProps } from 'recharts/types/chart/Sankey'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import type { RedashSankeyOptions } from '@/services/redash/types'
import { formatLabelValue } from '@/lib/chart-format'
import { resolveSeriesColor } from '@/lib/chart-colors'
import { CHART_INITIAL_DIMENSION, FILLABLE_PANEL_HEIGHT } from '@/lib/chart-marks'

// Sankey is not a recharts Cartesian chart, so chart/axis-config.ts does not
// cover its node label size.
const NODE_LABEL_FONT_SIZE = 12

function SankeyNode({ x, y, width, height, index, payload }: NodeProps) {
  // ResponsiveContainer reports its initialDimension for one frame before the
  // mount effect measures the real layout. recharts' own shapes no-op on a
  // non-positive size, but a custom node renderer must guard it or it emits NaN
  // coordinates for that frame.
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null
  }

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={resolveSeriesColor(payload.name, index)} />
      <text
        x={x + width + 6}
        y={y + height / 2}
        dy="0.35em"
        className="fill-foreground"
        fontSize={NODE_LABEL_FONT_SIZE}
      >
        {payload.name}
      </text>
    </g>
  )
}

/**
 * The hover panel, in the app's own tokens.
 *
 * recharts' default tooltip inlines an opaque white background and a light grey
 * border as style attributes, which no stylesheet reaches, so it stays white in
 * dark mode. Shaped like ChartTooltip rather than reusing it: that one leads
 * with an x-axis `label` a flow diagram has no equivalent of.
 */
// Partial, for the reason ChartTooltip is: recharts clones this element and
// supplies the props itself, so the call site passes none.
export function SankeyTooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  const entry = payload?.[0]
  if (!active || !entry) return null

  // `name` and nothing else. recharts builds it for both shapes this chart can
  // hover (Sankey.js, getPayloadOfTooltip): a node gets its own name, a link
  // gets "source - target" already joined. A link's own `source` and `target`
  // are number indexes, not nodes, so they cannot be read for a label here.
  const title = String(entry.name ?? '')

  return (
    <div className="rounded-md border bg-card px-3 py-2 text-sm shadow-md">
      {title && <div className="mb-1 font-medium text-card-foreground">{title}</div>}
      <div className="font-medium tabular-nums text-card-foreground">
        {formatLabelValue(entry.value)}
      </div>
    </div>
  )
}

interface SankeyRendererProps {
  visualization: MockVisualization
  data: QueryResultData
}

export function SankeyRenderer({ visualization, data }: SankeyRendererProps) {
  const options = (visualization.options ?? {}) as RedashSankeyOptions
  const columnMapping = options.columnMapping ?? {}

  const sourceCol = Object.entries(columnMapping).find(([, v]) => v === 'source')?.[0] || data.columns[0]?.name
  const targetCol = Object.entries(columnMapping).find(([, v]) => v === 'target')?.[0] || data.columns[1]?.name
  const valueCol = Object.entries(columnMapping).find(([, v]) => v === 'value')?.[0] || data.columns[2]?.name

  const sankeyData = useMemo(() => {
    if (!sourceCol || !targetCol || !valueCol) return null

    const nameToIndex = new Map<string, number>()
    const nodes: { name: string }[] = []
    const linkKeyToIndex = new Map<string, number>()
    const links: { source: number; target: number; value: number }[] = []

    const indexFor = (name: string): number => {
      let index = nameToIndex.get(name)
      if (index == null) {
        index = nodes.length
        nodes.push({ name })
        nameToIndex.set(name, index)
      }
      return index
    }

    for (const row of data.rows) {
      const source = String(row[sourceCol])
      const target = String(row[targetCol])
      const value = Number(row[valueCol]) || 0
      if (!source || !target || value <= 0) continue

      const sourceIndex = indexFor(source)
      const targetIndex = indexFor(target)
      const linkKey = `${sourceIndex}-${targetIndex}`
      const existingIndex = linkKeyToIndex.get(linkKey)
      if (existingIndex != null) {
        links[existingIndex].value += value
      } else {
        linkKeyToIndex.set(linkKey, links.length)
        links.push({ source: sourceIndex, target: targetIndex, value })
      }
    }

    return { nodes, links }
  }, [data.rows, sourceCol, targetCol, valueCol])

  if (!sankeyData || sankeyData.links.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">Sankey requires source, target, and value columns.</div>
  }

  return (
    <div className="p-4" style={{ height: FILLABLE_PANEL_HEIGHT }}>
      <ResponsiveContainer initialDimension={CHART_INITIAL_DIMENSION}>
        <Sankey
          data={sankeyData}
          node={SankeyNode}
          link={{ stroke: 'var(--muted-foreground)', strokeOpacity: 0.3 }}
          nodePadding={20}
          margin={{ top: 10, right: 100, bottom: 10, left: 10 }}
        >
          <Tooltip content={<SankeyTooltip />} />
        </Sankey>
      </ResponsiveContainer>
    </div>
  )
}
