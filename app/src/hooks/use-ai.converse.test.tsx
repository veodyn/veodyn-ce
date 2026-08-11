// useConverse, in its own file because use-ai.test.tsx sits at the file-size
// limit. The two things worth proving are the ones the mutation hook itself
// owns: the AbortSignal reaches fetch without reaching the request body, and an
// abort surfaces as a rejection rather than a resolved stale turn.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { http, HttpResponse, delay } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ConfigProvider } from '@/components/config/config-provider'
import { NEUTRAL_CONFIG, toClientConfig } from '@/lib/config-schema'
import { server } from '@/test/msw/server'
import type { ConverseResponse } from '@/types/ai-create'
import { useConverse } from './use-ai'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: false }))

const turn: ConverseResponse = {
  reply: 'Which stations do you mean?',
  suggestedAnswers: ['All of them', 'The busiest twenty'],
  ready: false,
  proposal: null,
  focusTable: null,
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return (
    <ConfigProvider value={{ ...toClientConfig(NEUTRAL_CONFIG), ai: { enabled: true } }}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ConfigProvider>
  )
}

describe('useConverse', () => {
  it('sends the transcript and keeps the signal out of the body', async () => {
    let body: unknown
    server.use(
      http.post('/api/ai/converse', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(turn)
      })
    )

    const { result } = renderHook(() => useConverse(), { wrapper })
    const controller = new AbortController()

    let response: ConverseResponse | undefined
    await act(async () => {
      response = await result.current.mutateAsync({
        kind: 'query',
        messages: [{ role: 'user', content: 'trips by station' }],
        signal: controller.signal,
      })
    })

    expect(response).toEqual(turn)
    // The whole body, not a subset: a `signal` key surviving into JSON is the
    // defect this guards, and toMatchObject would not see it.
    expect(body).toEqual({
      kind: 'query',
      messages: [{ role: 'user', content: 'trips by station' }],
    })
  })

  it('rejects the turn when the caller aborts it', async () => {
    server.use(
      http.post('/api/ai/converse', async () => {
        await delay(200)
        return HttpResponse.json(turn)
      })
    )

    const { result } = renderHook(() => useConverse(), { wrapper })
    const controller = new AbortController()

    await act(async () => {
      const pending = result.current.mutateAsync({
        kind: 'query',
        messages: [{ role: 'user', content: 'trips by station' }],
        signal: controller.signal,
      })
      controller.abort()
      await expect(pending).rejects.toThrow()
    })
  })
})
