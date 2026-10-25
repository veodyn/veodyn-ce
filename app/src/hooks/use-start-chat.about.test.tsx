import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from '@/components/ui/button'
import type { ChatThreadSubject } from '@/lib/chat/wire'
import { renderWithProviders } from '@/test/utils'
import { START_FAILED_MESSAGE, useStartChat } from './use-start-chat'

const client = vi.hoisted(() => ({ createThread: vi.fn(), postTurn: vi.fn(), deleteThread: vi.fn() }))
const push = vi.hoisted(() => vi.fn())
vi.mock('@/services/ai/chat-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/ai/chat-client')>()),
  ...client,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const SUBJECT: ChatThreadSubject = { kind: 'dashboard', dashboardId: 4 }

function Probe() {
  const chat = useStartChat()
  return (
    <div>
      <Button onClick={() => void chat.startAbout(SUBJECT)}>About</Button>
      <Button onClick={() => chat.start('hello')}>Ask</Button>
      <p>{chat.notice}</p>
    </div>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  client.createThread.mockResolvedValue({ id: 'new-thread' })
  client.postTurn.mockResolvedValue({ turnId: 'turn', seq: 1 })
  client.deleteThread.mockResolvedValue(undefined)
})

describe('useStartChat.startAbout', () => {
  it('creates a thread with the subject, posts no turn, and opens it', async () => {
    renderWithProviders(<Probe />)
    fireEvent.click(screen.getByRole('button', { name: 'About' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/chat/new-thread'))
    expect(client.createThread).toHaveBeenCalledWith(SUBJECT, expect.any(AbortSignal))
    expect(client.postTurn).not.toHaveBeenCalled()
  })

  it('reports a failed start and can start again', async () => {
    client.createThread.mockRejectedValueOnce(new Error('down'))
    renderWithProviders(<Probe />)
    fireEvent.click(screen.getByRole('button', { name: 'About' }))
    expect(await screen.findByText(START_FAILED_MESSAGE)).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'About' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/chat/new-thread'))
  })

  it('leaves start without a subject', async () => {
    renderWithProviders(<Probe />)
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/chat/new-thread'))
    expect(client.createThread).toHaveBeenCalledWith(undefined, expect.any(AbortSignal))
  })
})
