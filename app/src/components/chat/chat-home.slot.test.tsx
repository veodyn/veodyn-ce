import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from '@/components/ui/button'
import type { FeatureDescriptor, SlotProps } from '@/features/types'
import { renderWithProviders } from '@/test/utils'

function StartersStub({ onPick, disabled }: SlotProps['chat.starters']) {
  return (
    <Button disabled={disabled} onClick={() => onPick('On-time performance fell to 81%.')}>
      A contributed starter
    </Button>
  )
}

vi.mock('@/features/generated-registry', () => {
  const FEATURES: Record<string, FeatureDescriptor> = {
    reports: {
      id: 'reports',
      nav: [],
      routes: [],
      slots: { 'chat.starters': async () => ({ default: StartersStub }) },
    },
  }
  return { FEATURES }
})

const client = vi.hoisted(() => ({ createThread: vi.fn(), postTurn: vi.fn() }))
const push = vi.hoisted(() => vi.fn())
vi.mock('@/services/ai/chat-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/ai/chat-client')>()),
  ...client,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

import { ChatHome } from './chat-home'
import { CHAT_STARTERS } from './chat-starters'

beforeEach(() => {
  vi.clearAllMocks()
  client.createThread.mockResolvedValue({ id: 'new-thread' })
  client.postTurn.mockResolvedValue({ turnId: 'turn', seq: 1 })
})

describe('the chat starters slot', () => {
  it('renders the contributed starters in place of the suggested questions', async () => {
    renderWithProviders(<ChatHome />)
    expect(await screen.findByRole('button', { name: 'A contributed starter' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: CHAT_STARTERS[0] })).not.toBeInTheDocument()
  })

  it('starts a conversation with whatever the contributed starter picks', async () => {
    renderWithProviders(<ChatHome />)
    await userEvent.click(await screen.findByRole('button', { name: 'A contributed starter' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/chat/new-thread'))
    expect(client.postTurn).toHaveBeenCalledWith(
      'new-thread',
      'On-time performance fell to 81%.',
      expect.any(AbortSignal)
    )
  })
})

describe('the community suggested questions', () => {
  it('name no particular deployment', () => {
    expect(CHAT_STARTERS.join(' ')).not.toMatch(/bikeshare/i)
  })
})
