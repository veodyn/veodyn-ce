import type { MockQueryParameter } from '@/lib/mock-data'
import type { ParameterMappingValue } from './dashboard-changes'
import type { SavedQueryParameters } from './saved-query-parameters'

export type ParameterMappings = Record<string, ParameterMappingValue>

export function staticParameterMappings(
  definitions: readonly MockQueryParameter[],
  values: SavedQueryParameters | undefined
): ParameterMappings | undefined {
  if (!values) return undefined
  const mappings: ParameterMappings = {}
  for (const definition of definitions) {
    if (!Object.prototype.hasOwnProperty.call(values, definition.name)) continue
    mappings[definition.name] = {
      type: 'static-value',
      mapTo: definition.name,
      value: values[definition.name],
      title: definition.title || definition.name,
    }
  }
  return Object.keys(mappings).length > 0 ? mappings : undefined
}
