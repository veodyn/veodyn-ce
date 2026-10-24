import '@/plugins'
import { CHAT_GUIDE_MAX_CHARS, registeredTypes } from '@veodyn/viz/lib/visualizations'
import { config } from '@/lib/config'
import { visibilityOf, visibleVizChoices } from '@/lib/viz-choices'

export interface VizCatalogEntry {
  id: string
  type: string
  label: string
  guide?: string
}

export const CATALOG_LIMITS = { entries: 60, idChars: 64, typeChars: 64, labelChars: 80 } as const

const CORE_TYPES = ['TABLE', 'CHART', 'MAP'] as const

let reportedLostRegistration = false

function coreRegistrationLost(): boolean {
  const registered = new Set(registeredTypes())
  const missing = CORE_TYPES.filter((type) => !registered.has(type))
  if (missing.length === 0) return false
  if (!reportedLostRegistration) {
    reportedLostRegistration = true
    console.error(
      `[chat] the visualization registry lacks ${missing.join(', ')}, so the chat catalog is omitted and the ` +
        'sidecar falls back to its default. Core registration was lost in this module graph.'
    )
  }
  return true
}

function withinLimits(entry: VizCatalogEntry): boolean {
  return (
    entry.id.length <= CATALOG_LIMITS.idChars &&
    entry.type.length <= CATALOG_LIMITS.typeChars &&
    entry.label.length <= CATALOG_LIMITS.labelChars &&
    (entry.guide === undefined || entry.guide.length <= CHAT_GUIDE_MAX_CHARS)
  )
}

export function vizCatalog(): VizCatalogEntry[] {
  if (coreRegistrationLost()) return []
  return visibleVizChoices(visibilityOf(config))
    .map((choice) => ({
      id: choice.id,
      type: choice.type,
      label: choice.label,
      ...(choice.guide ? { guide: choice.guide } : {}),
    }))
    .filter(withinLimits)
    .slice(0, CATALOG_LIMITS.entries)
}
