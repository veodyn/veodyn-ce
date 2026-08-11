import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { ConfigProvider } from '@/components/config/config-provider'
import {
  NEUTRAL_CONFIG,
  toClientConfig,
  type ClientConfig,
} from '@/lib/config-schema'
import { server } from '@/test/msw/server'
import type { GenerateSqlRequest } from '@/types/ai'
import { useAiEnabled, useGenerateSql } from './use-ai'

const request: GenerateSqlRequest = {
  prompt: 'boardings by route',
  dataset: {
    table: 'trips',
    columns: [{ name: 'boardings', type: 'integer' }],
  },
}

function clientConfig(enabled: boolean): ClientConfig {
  return {
    ...toClientConfig(NEUTRAL_CONFIG),
    ai: { enabled },
  }
}

function wrapper(enabled: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })

  return function TestProviders({ children }: { children: ReactNode }) {
    return (
      <ConfigProvider value={clientConfig(enabled)}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ConfigProvider>
    )
  }
}

describe('AI hooks', () => {
  it.each([
    [true, true],
    [false, false],
  ])('useAiEnabled returns %s when config is %s', (enabled, expected) => {
    const { result } = renderHook(() => useAiEnabled(), {
      wrapper: wrapper(enabled),
    })

    expect(result.current).toBe(expected)
  })

  it('useGenerateSql resolves the service response', async () => {
    server.use(
      http.post('/api/ai/generate-sql', () =>
        HttpResponse.json({
          sql: 'SELECT sum(boardings) FROM trips',
          rationale: 'Grounded in trips.',
        })
      )
    )
    const { result } = renderHook(() => useGenerateSql(), {
      wrapper: wrapper(true),
    })

    let response: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined
    await act(async () => {
      response = await result.current.mutateAsync(request)
    })

    expect(response).toEqual({
      sql: 'SELECT sum(boardings) FROM trips',
      rationale: 'Grounded in trips.',
    })
  })
})
