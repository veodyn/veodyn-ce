export interface SavedRunSpec {
  queryId: number
  parameters: Record<string, unknown>
  visualizationId: number | null
}

export interface AdhocRunSpec {
  sql: string
  dataSourceId: number
  vizChoiceId?: string
}

export type RunSpec = ({ kind: 'adhoc' } & AdhocRunSpec) | ({ kind: 'saved' } & SavedRunSpec)
