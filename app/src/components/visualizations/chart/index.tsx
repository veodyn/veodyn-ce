'use client'

import { useMemo } from 'react'
import { useFormats } from '@/hooks/use-formats'
import { resolveChartConfig } from './resolve-config'
import { buildChartData } from './transform-data'
import { LineAreaChart } from './line-area-chart'
import { BarChart } from './bar-chart'
import { PieChart } from './pie-chart'
import { ScatterChart } from './scatter-chart'
import type { ChartRendererProps } from './types'

export function ChartRenderer({ visualization, data, annotations }: ChartRendererProps) {
  const config = useMemo(() => resolveChartConfig(visualization, data), [visualization, data])
  const chartData = useMemo(() => buildChartData(data, config), [data, config])
  // The one place a chart reads Settings > Formats. Every date a chart writes
  // (axis ticks, the date line under them, the tooltip, the accessible summary)
  // takes its form from here, threaded down as `patterns`, so a chart cannot
  // show one format on its axis and another in its tooltip. The renderers stay
  // free of hooks and remain testable without a provider.
  const patterns = useFormats()

  switch (config.chartType) {
    case 'pie':
      return <PieChart config={config} data={data} patterns={patterns} />
    case 'scatter':
      return <ScatterChart config={config} data={data} patterns={patterns} />
    case 'area':
      return <LineAreaChart variant="area" config={config} chartData={chartData} data={data} annotations={annotations} patterns={patterns} />
    case 'bar':
      return <BarChart config={config} chartData={chartData} data={data} patterns={patterns} />
    default:
      return <LineAreaChart variant="line" config={config} chartData={chartData} data={data} annotations={annotations} patterns={patterns} />
  }
}
