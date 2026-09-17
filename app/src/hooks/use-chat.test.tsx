import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { ConfigProvider } from '@/components/config/config-provider'
import { NEUTRAL_CONFIG, toClientConfig } from '@/lib/config-schema'
import { useAiChatEnabled } from './use-chat'

function wrapper(ai: { enabled: boolean; chat?: boolean }) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <ConfigProvider value={{ ...toClientConfig(NEUTRAL_CONFIG), ai }}>{children}</ConfigProvider>
  }
}

describe('useAiChatEnabled', () => {
  it.each([
    [{ enabled: true, chat: true }, true],
    [{ enabled: true, chat: false }, false],
    [{ enabled: false, chat: true }, false],
    [{ enabled: true }, false],
  ])('reads %j as %s', (ai, expected) => {
    expect(renderHook(() => useAiChatEnabled(), { wrapper: wrapper(ai) }).result.current).toBe(expected)
  })
})
