'use client'

import { Component, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '../ui/button'
import { VizError, VIZ_ERROR_IDS } from '../../lib/visualizations/viz-error'

interface VisualizationErrorBoundaryProps {
  children: ReactNode
}

interface VisualizationErrorBoundaryState {
  hasError: boolean
}

export class VisualizationErrorBoundary extends Component<VisualizationErrorBoundaryProps, VisualizationErrorBoundaryState> {
  state: VisualizationErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): VisualizationErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    const vizError = new VizError(VIZ_ERROR_IDS.RENDER_FAILED, 'Visualization failed to render', {
      cause: error.message,
    })
    console.error(vizError.toLogLine())
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-2 p-4 text-sm text-muted-foreground">
          <span>Failed to render visualization.</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => this.setState({ hasError: false })}
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}
