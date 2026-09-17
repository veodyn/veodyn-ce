import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAT_STARTERS } from '@/components/chat/chat-starters'
import { START_FAILED_MESSAGE } from '@/hooks/use-start-chat'
import { NEUTRAL_CONFIG, toClientConfig } from '@/lib/config-schema'
import { renderWithProviders } from '@/test/utils'
import { HomeChatCard, RECENT_CHATS } from './home-chat-card'

const client = vi.hoisted(() => ({ createThread: vi.fn(), postTurn: vi.fn(), listThreads: vi.fn() }))
const push = vi.hoisted(() => vi.fn())
vi.mock('@/services/ai/chat-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/ai/chat-client')>()),
  ...client,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const STAMP = '2026-09-17T00:00:00Z'
const chatOn = { ai: { ...toClientConfig(NEUTRAL_CONFIG).ai, enabled: true, chat: true } }

function thread(index: number, title = `Thread ${index}`) {
  return { id: `t${index}`, title, pinned: false, createdAt: STAMP, updatedAt: STAMP, lastTurnAt: STAMP }
}

beforeEach(() => {
  vi.clearAllMocks()
  client.createThread.mockResolvedValue({ id: 'new-thread' })
  client.postTurn.mockResolvedValue({ turnId: 'turn', seq: 1 })
  client.listThreads.mockResolvedValue({ threads: [], nextOffset: null })
})

describe('HomeChatCard', () => {
  it('renders nothing when chat is off', () => {
    const { container } = renderWithProviders(<HomeChatCard />)
    expect(container).toBeEmptyDOMElement()
    expect(client.listThreads).not.toHaveBeenCalled()
  })

  it('starts a conversation from the home page and opens it', async () => {
    renderWithProviders(<HomeChatCard />, { config: chatOn })
    expect(screen.getByRole('heading', { name: 'Ask about your data' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Chat' })).toHaveAttribute('href', '/chat')
    await userEvent.type(screen.getByRole('textbox', { name: 'Ask about your data' }), 'Which routes grew?{Enter}')
    await waitFor(() => expect(push).toHaveBeenCalledWith('/chat/new-thread'))
    expect(client.postTurn).toHaveBeenCalledWith('new-thread', 'Which routes grew?')
  })

  it('starts a conversation from a suggested question', async () => {
    renderWithProviders(<HomeChatCard />, { config: chatOn })
    await userEvent.click(screen.getByRole('button', { name: CHAT_STARTERS[0] }))
    await waitFor(() => expect(client.postTurn).toHaveBeenCalledWith('new-thread', CHAT_STARTERS[0]))
    expect(push).toHaveBeenCalledWith('/chat/new-thread')
  })

  it('says so when a conversation cannot start', async () => {
    client.createThread.mockRejectedValue(new Error('down'))
    renderWithProviders(<HomeChatCard />, { config: chatOn })
    await userEvent.click(screen.getByRole('button', { name: CHAT_STARTERS[1] }))
    expect(await screen.findByText(START_FAILED_MESSAGE)).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })

  it('links the most recent conversations', async () => {
    client.listThreads.mockResolvedValue({
      threads: [thread(1), thread(2, ''), thread(3), thread(4)],
      nextOffset: null,
    })
    renderWithProviders(<HomeChatCard />, { config: chatOn })
    expect(await screen.findByRole('link', { name: /Thread 1/ })).toHaveAttribute('href', '/chat/t1')
    expect(screen.getByRole('link', { name: /New conversation/ })).toHaveAttribute('href', '/chat/t2')
    expect(screen.queryByRole('link', { name: /Thread 4/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /Thread|New conversation/ })).toHaveLength(RECENT_CHATS)
  })
})
