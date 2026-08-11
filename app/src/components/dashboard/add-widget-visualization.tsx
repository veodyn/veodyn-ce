'use client'

import { ArrowLeft, BarChart3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getVisualization } from '@/lib/visualizations'
import type { MockQuery, MockVisualization } from '@/lib/mock-data'
import { getDefaultSize } from './add-widget-layout'

interface AddWidgetVisualizationProps {
  query: MockQuery
  onBack: () => void
  onSelectVisualization: (viz: MockVisualization) => void
}

export function AddWidgetVisualization({ query, onBack, onSelectVisualization }: AddWidgetVisualizationProps) {
  return (
    <div className="space-y-3">
      <Button variant="link" onClick={onBack} className="h-auto gap-1 p-0">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to search
      </Button>

      <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-md">
        <BarChart3 className="h-4 w-4 text-primary shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{query.name}</p>
          {query.description && (
            <p className="text-xs text-muted-foreground truncate">{query.description}</p>
          )}
        </div>
      </div>

      <p className="text-sm font-medium">Choose a visualization:</p>

      <div className="grid grid-cols-1 gap-2">
        {query.visualizations.map((viz) => {
          const vizType = getVisualization(viz.type)
          const Icon = vizType?.icon ?? BarChart3
          return (
            <Button
              key={viz.id}
              variant="outline"
              onClick={() => onSelectVisualization(viz)}
              className="h-auto justify-start gap-3 px-4 py-3 text-left"
            >
              <div className="h-9 w-9 rounded bg-primary/10 flex items-center justify-center shrink-0">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{viz.name}</p>
                <p className="text-xs text-muted-foreground">{vizType?.displayName ?? viz.type}</p>
              </div>
              <div className="text-xs text-muted-foreground shrink-0">
                {getDefaultSize(viz.type).sizeX}×{getDefaultSize(viz.type).sizeY}
              </div>
            </Button>
          )
        })}
      </div>
    </div>
  )
}
