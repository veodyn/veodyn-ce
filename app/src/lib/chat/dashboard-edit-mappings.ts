import type { RedashParameter } from '@/services/redash/types'
import type { ParameterMappingValue } from './dashboard-changes'

type Requested = Record<string, ParameterMappingValue>

export interface ResolvedMappings {
  mappings: Record<string, ParameterMappingValue>
  problems: string[]
}

const DASHBOARD_TYPES: ReadonlySet<string> = new Set(['dashboard-add-new', 'dashboard-map-to-existing'])

function missingValue(value: unknown): boolean {
  return value === undefined || value === null
}

export function resolveMappings(
  label: string,
  queryId: number,
  parameters: RedashParameter[],
  requested: Requested
): ResolvedMappings {
  const problems: string[] = []
  const mappings: Record<string, ParameterMappingValue> = {}
  const known = parameters.map((one) => one.name)
  for (const [name, mapping] of Object.entries(requested)) {
    const parameter = parameters.find((one) => one.name === name)
    if (!parameter) {
      problems.push(`${label}: query ${queryId} has no parameter ${name}. Its parameters are: ${known.join(', ') || 'none'}.`)
      continue
    }
    if (mapping.type === 'static-value' && missingValue(mapping.value)) {
      problems.push(`${label}: the static-value mapping for ${name} needs a value.`)
      continue
    }
    if (DASHBOARD_TYPES.has(mapping.type) && !mapping.mapTo) {
      problems.push(`${label}: the ${mapping.type} mapping for ${name} needs mapTo.`)
      continue
    }
    const mapTo = mapping.mapTo || (mapping.type === 'widget-level' ? name : undefined)
    const value = mapping.value !== undefined ? mapping.value : mapping.type === 'static-value' ? undefined : (parameter.value ?? null)
    mappings[name] = {
      type: mapping.type,
      ...(mapTo ? { mapTo } : {}),
      ...(value !== undefined ? { value } : {}),
      title: mapping.title || parameter.title || name,
    }
  }
  return { mappings, problems }
}
