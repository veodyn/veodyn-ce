import type { ComponentType } from 'react'
import type { PlacedAnnotation } from '../annotation-overlay'
import type { MockVisualization, QueryResultColumn, QueryResultData } from '../../types/viz-data'
import type { VizThumbnail } from '../../components/visualizations/viz-thumbnails'
import type { OptionSchema } from './option-schema'

export const PLUGIN_API_VERSION = 1

export interface VisualizationRendererProps {
  visualization: MockVisualization
  data: QueryResultData
  annotations?: PlacedAnnotation[]
  onOptionsChange?: (options: Record<string, unknown>) => void
  retrievedAt?: string | null
}

export interface VisualizationEditorProps {
  options: Record<string, unknown>
  columns: QueryResultColumn[]
  data?: QueryResultData
  onChange: (options: Record<string, unknown>) => void
}

export interface VisualizationChoice {
  id: string
  label: string
  options: Record<string, unknown>
  Thumbnail: VizThumbnail
  guide?: string
}

export type VisualizationAudience = 'analyst' | 'internal'

export interface VisualizationPlugin {
  apiVersion: number
  type: string
  displayName: string
  icon: ComponentType<{ className?: string }>
  defaultOptions: Record<string, unknown>

  audience?: VisualizationAudience

  needs?: 'query-result' | 'none'

  Renderer: ComponentType<VisualizationRendererProps>
  Editor?: ComponentType<VisualizationEditorProps>

  inferOptions?(
    defaults: Record<string, unknown>,
    data: QueryResultData
  ): Record<string, unknown>

  validate?(options: Record<string, unknown>, data: QueryResultData): string[]

  choices?: VisualizationChoice[]

  publicOptions?: OptionSchema
}
