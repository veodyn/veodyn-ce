// Pack-neutral home for the destination-type fixture shape.
// `la/destination-types.ts` re-exports this so `from './destination-types'`
// imports inside packs/la keep resolving; packs/neutral imports directly from
// here.
export interface MockDestinationType {
  type: string
  name: string
  configuration_schema: {
    type: 'object'
    properties: Record<string, { type: string; title: string; default?: unknown }>
    required: string[]
    secret: string[]
  }
  icon: string
}
