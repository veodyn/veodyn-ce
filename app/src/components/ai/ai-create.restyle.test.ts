import { describe, expect, it } from 'vitest'
import { findRedashEraChrome, readAppSource } from '@/test/redash-era-chrome'

// The AI creation surfaces this build owns: the Create-with-AI chat and every
// card it draws itself. It replaces ai-report.restyle.test.ts, which was
// deleted along with the report wizard the chat supersedes.
//
// app/reports/new/page.tsx is deliberately absent: reports.restyle.test.ts
// already covers it, and it is now a manual form with no AI in it.
//
// Three AI surfaces are absent because they belong to feature packages rather
// than to this tree: the KPI and report proposal cards, the Home AI digest and
// the dashboard annotation suggester. A build that installs those packages
// sweeps them in its own suite, against the real files. Listing them here
// would name paths this build does not contain, and the only way to keep such
// a list green is to skip what is missing, which is a guard that cannot fail.
const files = [
  'components/ai/create-chat/create-with-ai-button.tsx',
  'components/ai/create-chat/create-chat-dialog.tsx',
  'components/ai/create-chat/create-chat-transcript.tsx',
  'components/ai/create-chat/create-chat-model.ts',
  'components/ai/create-chat/use-create-chat.ts',
  'components/ai/create-chat/proposals/proposal-panel.tsx',
  'components/ai/create-chat/proposals/proposal-frame.tsx',
  'components/ai/create-chat/proposals/query-proposal.tsx',
  'components/ai/create-chat/proposals/dashboard-proposal.tsx',
  'components/ai/create-chat/proposals/snippet-proposal.tsx',
  'components/ai/create-chat/proposals/proposal-model.ts',
  'components/ai/create-chat/proposals/use-create-from-proposal.ts',
]

// Without this the sweep passes vacuously over a list that has been emptied,
// which is exactly how a guard goes blind. Realness needs no separate check:
// readAppSource reads each name off disk and throws when it is not there, so a
// path that stops existing fails its own case instead of being skipped.
const MINIMUM_FILES = 12

describe('AI creation surfaces carry no Redash-era chrome', () => {
  it('has a non-empty list of surfaces to sweep', () => {
    expect(files.length).toBeGreaterThanOrEqual(MINIMUM_FILES)
  })

  it.each(files)('%s uses only Editorial Light tokens/primitives', (rel) => {
    expect(findRedashEraChrome(readAppSource(rel))).toEqual([])
  })
})
