import '@/plugins'
import { config } from '@/lib/config'
import { visibleVizChoices } from '@/lib/viz-choices'

export interface VizCatalogEntry {
  id: string
  type: string
  label: string
  guide?: string
}

export function vizCatalog(): VizCatalogEntry[] {
  return visibleVizChoices(config.visualizations).map((choice) => ({
    id: choice.id,
    type: choice.type,
    label: choice.label,
    ...(choice.guide ? { guide: choice.guide } : {}),
  }))
}
