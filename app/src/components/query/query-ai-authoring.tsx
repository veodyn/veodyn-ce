'use client'

// The AI half of the query editor's authoring surface: the Visual/PRO mode
// toggle and the natural-language prompt bar. The page mounts both only when
// config.ai.enabled is true, so with AI off none of it is in the tree at all.
//
// They are two components rather than one because they belong to different rows
// of the page. The toggle chooses which surface is below it, so it sits in a
// full-width row of its own directly under the query title, outside the columns
// it switches. The prompt bar is part of what PRO shows, so it stays inside the
// editor column.
//
// Both tabs are always live. The Visual builder still does not parse SQL back
// into its field picker, but that is a reason for the two surfaces to hold
// their own state, not a reason to close one of them: the picks are kept by the
// page and are still there whenever the analyst comes back to them.
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CreateWithAiButton } from '@/components/ai/create-chat/create-with-ai-button'
import type { MockDataSource, SchemaTable } from '@/lib/mock-data'
import { AiPromptBar } from './ai-prompt-bar'
import { aiDatasetFromSchema, sqlGenerationBlockedReason } from './query-ai-model'

/**
 * The mode value stays `pro` while the label reads "SQL Editor". "PRO" said
 * nothing about the mode and read as a pricing tier; the two modes are the
 * visual builder and raw SQL, so the tab now says so.
 *
 * The value is deliberately not renamed with it: it is held in memory only,
 * never persisted or put in a URL, so it is an internal name for the same
 * thing, and renaming it would churn the identifiers (`switchToPro`,
 * `openProTab`, `onRequestPro`) across the editor for no reader's benefit.
 */
export type AuthoringMode = 'visual' | 'pro'

interface QueryAuthoringModeTabsProps {
  mode: AuthoringMode
  onModeChange: (mode: AuthoringMode) => void
  onRequestPro: () => void
}

export function QueryAuthoringModeTabs({
  mode,
  onModeChange,
  onRequestPro,
}: QueryAuthoringModeTabsProps) {
  // Leaving Visual for PRO can carry the composed SQL along, so the editor opens
  // on the query the analyst was just looking at rather than on an empty buffer
  // behind it. Whether it does is the page's call, since only the page knows
  // whether that buffer holds anything worth keeping. Either way it is a
  // handoff, not a commitment: the same tab brings them back. Every other move
  // is a plain mode change.
  function handleTabChange(next: string) {
    if (next === 'pro' && mode === 'visual') {
      onRequestPro()
      return
    }
    onModeChange(next === 'visual' ? 'visual' : 'pro')
  }

  // `px-4` matches the header above it so the toggle sits under the query title
  // rather than under an indent of its own.
  return (
    <div className="flex flex-wrap items-center gap-3 border-b bg-card px-4 py-2">
      <Tabs value={mode} onValueChange={handleTabChange}>
        <TabsList aria-label="Authoring mode">
          <TabsTrigger value="visual">Visual</TabsTrigger>
          <TabsTrigger value="pro">SQL Editor</TabsTrigger>
        </TabsList>
      </Tabs>
      {/* The conversational path to a whole query, in the one row that belongs
          to neither surface, so it is reachable from both. PRO's prompt bar
          edits the buffer under it and Visual has no prompt at all; this asks
          for a query from nothing and saves the one that comes back, which is
          why it sits beside the toggle rather than inside either column. */}
      <div className="ml-auto">
        <CreateWithAiButton kind="query" />
      </div>
    </div>
  )
}

interface QueryAiPromptBarProps {
  schema: SchemaTable[]
  currentSql: string
  onGenerated: (sql: string) => void
  /** The source the editor is pointed at, or null while the list is loading. */
  dataSource: MockDataSource | null
}

/**
 * The prompt bar over the PRO editor's own schema, mounted by PRO only. In
 * Visual mode the builder owns its Run and its Open-in-PRO, so a bar here would
 * let a generated draft land in a buffer the analyst cannot see.
 *
 * It also decides whether generation applies to the source at all. The bar used
 * to offer it for every one of them and ground on whatever the schema listed
 * first, so a source whose tree is API documentation rather than tables sent
 * the service a table no statement can name, and the two refusals came back as
 * "AI is unavailable right now".
 */
export function QueryAiPromptBar({
  schema,
  currentSql,
  onGenerated,
  dataSource,
}: QueryAiPromptBarProps) {
  const dataset = aiDatasetFromSchema(schema, currentSql)
  return (
    <AiPromptBar
      dataset={dataset}
      currentSql={currentSql}
      onGenerated={onGenerated}
      blockedReason={sqlGenerationBlockedReason(dataSource, dataset, schema)}
    />
  )
}
