export interface SavedRunSpec {
  queryId: number
  parameters: Record<string, unknown>
  visualizationId: number | null
}

export type RunSpec =
  | { kind: 'adhoc'; sql: string; dataSourceId: number; vizChoiceId?: string }
  | ({ kind: 'saved' } & SavedRunSpec)
