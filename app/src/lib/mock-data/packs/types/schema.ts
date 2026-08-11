// Pack-neutral home for the schema fixture shapes. `la/schema.ts` re-exports
// these so `from './schema'` imports inside packs/la keep resolving;
// packs/neutral imports directly from here.
export interface SchemaColumn {
  name: string
  type: string
}

export interface SchemaTable {
  name: string
  columns: SchemaColumn[]
}
