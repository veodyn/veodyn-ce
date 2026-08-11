import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import type { PlacedAnnotation } from '@/lib/annotation-overlay'

export interface ChartRendererProps {
  visualization: MockVisualization
  data: QueryResultData
  annotations?: PlacedAnnotation[]
}
