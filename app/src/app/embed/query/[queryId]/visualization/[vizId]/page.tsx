'use client'

import { use } from 'react'
import { useQueryById } from '@/hooks/use-queries'
import { useQueryResult } from '@/hooks/use-query-execution'
import { visualizationData } from '@/lib/visualizations'
import { VisualizationRenderer } from '@/components/visualizations/visualization-renderer'

export default function EmbedVisualizationPage({
  params,
}: {
  params: Promise<{ queryId: string; vizId: string }>
}) {
  const { queryId, vizId } = use(params)
  const qId = parseInt(queryId, 10)
  const vId = parseInt(vizId, 10)
  const { data: query } = useQueryById(qId)
  const { data: queryResult } = useQueryResult(query?.latest_query_data_id)

  const viz = query?.visualizations.find((v) => v.id === vId)

  // An embed is dropped into someone else's page at whatever size they gave it,
  // so this fills the frame rather than putting a line of grey text in the
  // top-left corner of an iframe the host sized for a chart.
  if (!query || !viz) {
    return (
      <div
        role="status"
        aria-label="Loading visualization"
        className="h-full min-h-32 w-full bg-muted/40 motion-safe:animate-pulse"
      />
    )
  }

  // A type that draws from something other than this query's rows is handed an
  // empty result rather than this branch, so an embed of one is not a page that
  // says "No data available" forever.
  const data = visualizationData(viz.type, queryResult?.data)
  if (!data) {
    return <div className="p-4 text-muted-foreground">No data available</div>
  }

  return (
    <div className="min-h-screen bg-background">
      <VisualizationRenderer visualization={viz} data={data} />
    </div>
  )
}
