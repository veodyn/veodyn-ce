import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/utils'
import { ChatHome, START_FAILED_MESSAGE } from './chat-home'

const client = vi.hoisted(() => ({ createThread: vi.fn(), postTurn: vi.fn() }))
const push = vi.hoisted(() => vi.fn())
vi.mock('@/services/ai/chat-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/ai/chat-client')>()),
  ...client,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

beforeEach(() => {
  vi.clearAllMocks()
  client.createThread.mockResolvedValue({ id: 'new-thread' })
  client.postTurn.mockResolvedValue({ turnId: 'turn', seq: 1 })
})

describe('ChatHome', () => {
  it('starts a conversation with the first message and opens it', async () => {
    renderWithProviders(<ChatHome />)
    await userEvent.type(screen.getByLabelText('Ask about your data'), 'Which routes grew?{Enter}')
    await waitFor(() => expect(push).toHaveBeenCalledWith('/chat/new-thread'))
    expect(client.postTurn).toHaveBeenCalledWith('new-thread', 'Which routes grew?')
  })

  it('says so when the conversation cannot start', async () => {
    client.createThread.mockRejectedValue(new Error('down'))
    renderWithProviders(<ChatHome />)
    await userEvent.type(screen.getByLabelText('Ask about your data'), 'hello')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText(START_FAILED_MESSAGE)).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })

  it('does not send an empty message', async () => {
    renderWithProviders(<ChatHome />)
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Ask about your data'), '   {Enter}')
    expect(client.createThread).not.toHaveBeenCalled()
  })
})
