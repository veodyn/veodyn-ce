// Shared setup for the QueryEditorPage suites. Not a test file itself (the name
// deliberately avoids the `.test.` pattern vitest collects): just the render
// helper both suites need, so each one can stay under the file size limit.
import type { RenderResult } from '@testing-library/react'
import { ConfigProvider } from '@/components/config/config-provider'
import { NEUTRAL_CONFIG, toClientConfig, type ClientConfig } from '@/lib/config-schema'
import { renderWithProviders } from '@/test/utils'
import { QueryEditorPage } from './query-editor-page'

export function clientConfig(aiEnabled: boolean, queryDrafts = false): ClientConfig {
  const neutral = toClientConfig(NEUTRAL_CONFIG)
  return {
    ...neutral,
    ai: { enabled: aiEnabled },
    features: { ...neutral.features, query_drafts: queryDrafts },
  }
}

export function renderQueryEditorPage({
  aiEnabled,
  queryId,
  // Defaults to the product default: the draft workflow is off, so Save is what
  // shares a query. A suite that wants the other half asks for it.
  queryDrafts = false,
}: {
  aiEnabled: boolean
  /** Omitted for a new query, which is the page's other half: create, not update. */
  queryId?: number
  queryDrafts?: boolean
}): RenderResult {
  return renderWithProviders(
    <ConfigProvider value={clientConfig(aiEnabled, queryDrafts)}>
      <QueryEditorPage queryId={queryId} />
    </ConfigProvider>
  )
}
