import { isAppError } from '@/lib/errorIds'

export interface DataSourceOption {
  id: number
  name: string
  type: string
}

export function defaultDataSourceId(dataSources: DataSourceOption[]): number | null {
  const clickhouse = dataSources.find((source) => source.type.toLowerCase().includes('clickhouse'))
  return clickhouse?.id ?? dataSources[0]?.id ?? null
}

export function createErrorMessage(objectLabel: string, error: unknown): string | null {
  if (error == null) return null
  if (isAppError(error)) return `Could not create this ${objectLabel}. ${error.message} [${error.id}]`
  if (error instanceof Error) return `Could not create this ${objectLabel}. ${error.message}`
  return `Could not create this ${objectLabel}.`
}
