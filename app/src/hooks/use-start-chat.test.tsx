import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from '@/components/ui/button'
import { renderWithProviders } from '@/test/utils'
import { START_FAILED_MESSAGE, useStartChat } from './use-start-chat'

const client = vi.hoisted(() => ({ createThread: vi.fn(), postTurn: vi.fn(), deleteThread: vi.fn() }))
const push = vi.hoisted(() => vi.fn())
vi.mock('@/services/ai/chat-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/ai/chat-client')>()),
  ...client,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

function Probe({ texts }: { texts: string[] }) {
  const chat = useStartChat()
  return (
    <div>
      <Button onClick={() => texts.forEach((text) => chat.start(text))}>Start</Button>
      <p>{chat.notice}</p>
    </div>
  )
}

function startAll() {
  fireEvent.click(screen.getByRole('button', { name: 'Start' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  client.createThread.mockResolvedValue({ id: 'new-thread' })
  client.postTurn.mockResolvedValue({ turnId: 'turn', seq: 1 })
  client.deleteThread.mockResolvedValue(undefined)
})

describe('useStartChat', () => {
  it('deletes the conversation it made when the first message cannot be sent', async () => {
    client.postTurn.mockRejectedValue(new Error('down'))
    renderWithProviders(<Probe texts={['hello']} />)
    startAll()
    expect(await screen.findByText(START_FAILED_MESSAGE)).toBeInTheDocument()
    expect(client.deleteThread).toHaveBeenCalledWith('new-thread')
    expect(push).not.toHaveBeenCalled()
  })

  it('still reports the failure when the cleanup fails too', async () => {
    client.postTurn.mockRejectedValue(new Error('down'))
    client.deleteThread.mockRejectedValue(new Error('also down'))
    renderWithProviders(<Probe texts={['hello']} />)
    startAll()
    expect(await screen.findByText(START_FAILED_MESSAGE)).toBeInTheDocument()
  })

  it('deletes nothing when no conversation was made', async () => {
    client.createThread.mockRejectedValue(new Error('down'))
    renderWithProviders(<Probe texts={['hello']} />)
    startAll()
    expect(await screen.findByText(START_FAILED_MESSAGE)).toBeInTheDocument()
    expect(client.deleteThread).not.toHaveBeenCalled()
  })

  it('starts once when asked twice before the first render', async () => {
    renderWithProviders(<Probe texts={['first', 'second']} />)
    startAll()
    await waitFor(() => expect(push).toHaveBeenCalledWith('/chat/new-thread'))
    expect(client.createThread).toHaveBeenCalledTimes(1)
    expect(client.postTurn).toHaveBeenCalledWith('new-thread', 'first', expect.any(AbortSignal))
  })

  it('can start again after a failure', async () => {
    client.createThread.mockRejectedValueOnce(new Error('down'))
    renderWithProviders(<Probe texts={['hello']} />)
    startAll()
    await screen.findByText(START_FAILED_MESSAGE)
    startAll()
    await waitFor(() => expect(push).toHaveBeenCalledWith('/chat/new-thread'))
  })

  it('cleans up and stays quiet when the screen goes away mid-start', async () => {
    let failTurn: (error: Error) => void = () => undefined
    client.postTurn.mockReturnValue(new Promise((_, reject) => (failTurn = reject)))
    const view = renderWithProviders(<Probe texts={['hello']} />)
    startAll()
    await waitFor(() => expect(client.postTurn).toHaveBeenCalled())
    const signal = client.postTurn.mock.calls[0][2] as AbortSignal
    view.unmount()
    expect(signal.aborted).toBe(true)
    failTurn(new DOMException('aborted', 'AbortError'))
    await waitFor(() => expect(client.deleteThread).toHaveBeenCalledWith('new-thread'))
    expect(push).not.toHaveBeenCalled()
  })
})
