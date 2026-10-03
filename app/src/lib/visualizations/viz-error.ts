export const VIZ_ERROR_IDS = {
  RENDER_FAILED: 'E_UI_001',
  GEOJSON_FAILED: 'E_UI_002',
} as const

export type VizErrorId = (typeof VIZ_ERROR_IDS)[keyof typeof VIZ_ERROR_IDS]

export class VizError extends Error {
  readonly id: VizErrorId
  readonly context: Record<string, unknown>

  constructor(id: VizErrorId, message: string, context: Record<string, unknown> = {}) {
    super(message)
    this.id = id
    this.context = context
    this.name = 'VizError'
  }

  toLogLine(): string {
    const ctx = Object.entries(this.context)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(' ')
    return `[${this.id}] ${this.message}${ctx ? ' ' + ctx : ''}`
  }
}
