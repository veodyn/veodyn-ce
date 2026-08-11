import { describe, expect, it } from 'vitest'
import { findRedashEraChrome, readAppSource } from '@/test/redash-era-chrome'

// The AI authoring surfaces in the query editor. Task owners append their own
// files here as they land (the prompt bar in Task 3, the editor page in Task 5).
const files = [
  'components/query/ai-prompt-bar.tsx',
  'components/query/visual-builder.tsx',
  'components/query/visual-builder-fields.tsx',
  'components/query/visual-builder-clauses.tsx',
  'components/query/visual-builder-controls.tsx',
  'components/query/visual-builder-model.ts',
  'components/query/query-ai-authoring.tsx',
  'components/query/query-visual-pane.tsx',
  'components/query/query-ai-model.ts',
  'components/query/query-editor-page.tsx',
]

describe('AI editor surfaces carry no Redash-era chrome', () => {
  it.each(files)('%s uses only Editorial Light tokens/primitives', (rel) => {
    expect(findRedashEraChrome(readAppSource(rel))).toEqual([])
  })
})
