import type { MockQuery } from '../types/query-types'
import { mockQueriesSetA } from './queries-set-a'
import { mockQueriesSetB } from './queries-set-b'
import { vizQueriesC } from './viz-fixtures-c'
import { vizQueriesD } from './viz-fixtures-d'
import { vizQueriesE } from './viz-fixtures-e'
import { vizQueriesF } from './viz-fixtures-f'

// The fixture data lives in queries-set-a.ts (ids 1-5) and queries-set-b.ts
// (ids 6-10), split to stay under the repo's file-size hook. This file is
// the stable import surface: `mockQueries` mirrors packs/la/queries.ts.
//
// viz-fixtures-c/d/e/f carry queries 11-21, one per visualization type that had
// no fixture at all. They stay in their own files rather than growing the sets
// above, so the id ranges each file owns keep saying who is responsible for
// what.
export const mockQueries: MockQuery[] = [
  ...mockQueriesSetA,
  ...mockQueriesSetB,
  ...vizQueriesC,
  ...vizQueriesD,
  ...vizQueriesE,
  ...vizQueriesF,
]
