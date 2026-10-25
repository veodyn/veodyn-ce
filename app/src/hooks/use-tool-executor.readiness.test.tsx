import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MapProvidersContext, PLUGIN_API_VERSION, registerVisualization, type MapProvider } from '@veodyn/viz'
import type { ChatToolRequest } from '@/lib/chat/frames'

const postToolResult = vi.hoisted(() => vi.fn())
const queries = vi.hoisted(() => ({ get: vi.fn() }))
const execution = vi.hoisted(() => ({ executeSavedQuery: vi.fn(), executeAdhoc: vi.fn() }))

vi.mock('@/services/ai/chat-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/ai/chat-client')>()),
  postToolResult,
}))
vi.mock('@/lib/chat/node-calls', () => ({
  getQuery: (_transport: unknown, id: number) => queries.get(id),
  executeSavedQuery: (_transport: unknown, id: number, opts: unknown) => execution.executeSavedQuery(id, opts),
  executeAdhoc: (_transport: unknown, ...args: unknown[]) => execution.executeAdhoc(...args),
}))

import { useToolExecutor } from './use-tool-executor'

const NEEDS_KEY = 'needs a Google Maps key'

registerVisualization({
  apiVersion: PLUGIN_API_VERSION,
  type: 'TEST_KEYED_MAP',
  displayName: 'Keyed map',
  icon: () => null,
  defaultOptions: {},
  Renderer: () => null,
  mapProvider: 'google',
  choices: [{ id: 'test-keyed-map', label: 'Keyed map', options: {}, Thumbnail: () => null }],
  readiness: (options, context) =>
    options.apiKey || context.mapProviders.some((provider) => provider.id === 'google' && provider.key)
      ? null
      : NEEDS_KEY,
})

registerVisualization({
  apiVersion: PLUGIN_API_VERSION,
  type: 'TEST_BROKEN_READINESS',
  displayName: 'Broken readiness',
  icon: () => null,
  defaultOptions: {},
  Renderer: () => null,
  readiness: () => {
    throw new Error('plugin bug')
  },
})

registerVisualization({
  apiVersion: PLUGIN_API_VERSION,
  type: 'TEST_WORDY_READINESS',
  displayName: 'Wordy readiness',
  icon: () => null,
  defaultOptions: {},
  Renderer: () => null,
  readiness: () => 'w'.repeat(900),
})

const DATA = { columns: [{ name: 'n', type: 'integer', friendly_name: 'n' }], rows: [{ n: 1 }] }

function savedRequest(): ChatToolRequest {
  return {
    callId: 's1',
    tool: 'run_saved_query',
    args: { queryId: 137, parameters: {}, visualizationId: 1372, purpose: 'p' },
  }
}

function savedQueryWith(type: string, options: Record<string, unknown> = {}) {
  return {
    id: 137,
    name: 'Detours',
    data_source_id: 15,
    is_archived: false,
    options: { parameters: [] },
    visualizations: [{ id: 1372, type, name: 'Viz', options }],
  }
}

function withProviders(providers: readonly MapProvider[]) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <MapProvidersContext.Provider value={providers}>{children}</MapProvidersContext.Provider>
  }
  return Wrapper
}

async function posted(request: ChatToolRequest, wrapper?: ({ children }: { children: ReactNode }) => ReactNode) {
  const { result } = renderHook(() => useToolExecutor(), wrapper ? { wrapper } : undefined)
  act(() => result.current.execute('turn', request, vi.fn()))
  await waitFor(() => expect(postToolResult).toHaveBeenCalled())
  return postToolResult.mock.calls[0][2] as Record<string, unknown>
}

beforeEach(() => {
  vi.resetAllMocks()
  postToolResult.mockResolvedValue({ accepted: true })
  execution.executeSavedQuery.mockResolvedValue({ id: 9, data: DATA })
  execution.executeAdhoc.mockResolvedValue({ data: DATA })
})

describe('a readiness notice on a posted result', () => {
  it('readiness_message_becomes_result_notice', async () => {
    queries.get.mockResolvedValue(savedQueryWith('TEST_KEYED_MAP'))
    const result = await posted(savedRequest())
    expect(result).toMatchObject({ kind: 'query_result', ok: true, notice: NEEDS_KEY })
  })

  it('readiness_runs_on_the_choice_a_plain_query_asked_for', async () => {
    const result = await posted({
      callId: 'a1',
      tool: 'run_query',
      args: { dataSourceId: 4, sql: 'SELECT 1', purpose: 'p', vizChoiceId: 'test-keyed-map' },
    })
    expect(result).toMatchObject({ ok: true, notice: NEEDS_KEY })
  })

  it('the_visualizations_own_key_means_no_notice', async () => {
    queries.get.mockResolvedValue(savedQueryWith('TEST_KEYED_MAP', { apiKey: 'saved-key' }))
    expect(await posted(savedRequest())).not.toHaveProperty('notice')
  })

  it('the_instance_provider_key_means_no_notice', async () => {
    queries.get.mockResolvedValue(savedQueryWith('TEST_KEYED_MAP'))
    const wrapper = withProviders([{ id: 'google', label: 'Google', key: 'instance-key' }])
    expect(await posted(savedRequest(), wrapper)).not.toHaveProperty('notice')
  })

  it('a_type_with_no_readiness_check_adds_nothing', async () => {
    queries.get.mockResolvedValue(savedQueryWith('TABLE'))
    expect(await posted(savedRequest())).not.toHaveProperty('notice')
  })

  it('a_plugin_that_throws_from_readiness_never_blocks_the_result', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    queries.get.mockResolvedValue(savedQueryWith('TEST_BROKEN_READINESS'))
    const result = await posted(savedRequest())
    expect(result).toMatchObject({ ok: true })
    expect(result).not.toHaveProperty('notice')
    expect(error).toHaveBeenCalled()
  })

  it('a_long_notice_is_cut_to_the_contract_limit', async () => {
    queries.get.mockResolvedValue(savedQueryWith('TEST_WORDY_READINESS'))
    const result = await posted(savedRequest())
    expect(String(result.notice)).toHaveLength(300)
  })
})
