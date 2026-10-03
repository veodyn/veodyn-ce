import type { MockVisualization, QueryResultData } from '../../../types/viz-data'
import type { PlacedAnnotation } from '../../../lib/annotation-overlay'

export interface ChartRendererProps {
  visualization: MockVisualization
  data: QueryResultData
  annotations?: PlacedAnnotation[]
}
