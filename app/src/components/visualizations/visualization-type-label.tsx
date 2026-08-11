'use client'

import { Plug } from 'lucide-react'
import { visualizationLabel, visualizationOrigin } from '@/lib/visualizations'

/**
 * How a visualization type names itself in a list that mixes the product's own
 * types with an instance's installed ones.
 *
 * A plugin type reads `Plugin[Ticker]` behind a plug, so someone scanning the
 * type selector can tell which entries came with the product and which this
 * deployment added, without knowing that a registry exists. Core types are
 * named plainly and carry no icon: marking everything would mark nothing.
 *
 * The marker is presentation only. It never reaches the saved visualization,
 * whose name still defaults to the plugin's plain `displayName`, because the
 * name is data and this is a note about where the code came from.
 */
export function VisualizationTypeLabel({ type }: { type: string }) {
  const isPlugin = visualizationOrigin(type) === 'plugin'
  return (
    <span className="flex items-center gap-1.5">
      {isPlugin && (
        <Plug className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      {visualizationLabel(type)}
    </span>
  )
}
