import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from '@/components/ui/button'
import type { ChatThreadSubject } from '@/lib/chat/wire'
import { renderWithProviders } from '@/test/utils'
import { useOpenChatAbout, useStartChat } from './use-start-chat'

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
  const openAbout = useOpenChatAbout()
  return (
    <div>
      <Button onClick={() => openAbout(SUBJECT)}>About</Button>
      <Button onClick={() => chat.start('what changed?', SUBJECT)}>Ask about</Button>
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

describe('useOpenChatAbout', () => {
  it('opens the chat home about the subject and creates no thread', async () => {
    renderWithProviders(<Probe />)
    fireEvent.click(screen.getByRole('button', { name: 'About' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/chat?about=dashboard&dashboardId=4'))
    expect(client.createThread).not.toHaveBeenCalled()
    expect(client.postTurn).not.toHaveBeenCalled()
  })
})

describe('useStartChat with a subject', () => {
  it('creates the thread with the subject and its first turn, then opens it', async () => {
    renderWithProviders(<Probe />)
    fireEvent.click(screen.getByRole('button', { name: 'Ask about' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/chat/new-thread'))
    expect(client.createThread).toHaveBeenCalledWith(SUBJECT, expect.any(AbortSignal))
    expect(client.postTurn).toHaveBeenCalledWith('new-thread', 'what changed?', expect.any(AbortSignal))
  })

  it('leaves start without a subject', async () => {
    renderWithProviders(<Probe />)
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/chat/new-thread'))
    expect(client.createThread).toHaveBeenCalledWith(undefined, expect.any(AbortSignal))
  })
})
