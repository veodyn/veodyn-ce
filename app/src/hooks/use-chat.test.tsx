import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigProvider } from '@/components/config/config-provider'
import { NEUTRAL_CONFIG, toClientConfig } from '@/lib/config-schema'
import { useAiChatEnabled } from './use-chat'

function wrapper(ai: { enabled: boolean }) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <ConfigProvider value={{ ...toClientConfig(NEUTRAL_CONFIG), ai }}>{children}</ConfigProvider>
  }
}

describe('useAiChatEnabled', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_REDASH_URL', 'http://redash.test'))
  afterEach(() => vi.unstubAllEnvs())

  it.each([
    [{ enabled: true }, true],
    [{ enabled: false }, false],
  ])('reads %j as %s', (ai, expected) => {
    expect(renderHook(() => useAiChatEnabled(), { wrapper: wrapper(ai) }).result.current).toBe(expected)
  })

  it('is off in mock mode, where the relay refuses with no live backend', () => {
    vi.stubEnv('NEXT_PUBLIC_REDASH_URL', '')
    expect(renderHook(() => useAiChatEnabled(), { wrapper: wrapper({ enabled: true }) }).result.current).toBe(false)
  })
})
