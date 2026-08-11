// Pack-neutral home for the data-source-type fixture shapes.
// `la/data-source-types.ts` re-exports these so `from './data-source-types'`
// imports inside packs/la keep resolving; packs/neutral imports directly from
// here.
export interface ConfigSchemaProperty {
  type: string
  title?: string
  default?: unknown
  required?: boolean
  order?: number
  description?: string
}

export interface MockDataSourceType {
  type: string
  name: string
  configuration_schema: {
    type: 'object'
    properties: Record<string, ConfigSchemaProperty>
    order: string[]
    required: string[]
    secret: string[]
  }
}
