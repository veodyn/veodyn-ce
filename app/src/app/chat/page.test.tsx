import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/utils'
import ChatPage from './page'

vi.stubEnv('NEXT_PUBLIC_REDASH_URL', 'http://redash.test')

const client = vi.hoisted(() => ({ createThread: vi.fn(), postTurn: vi.fn(), listThreads: vi.fn() }))
const push = vi.hoisted(() => vi.fn())
const search = vi.hoisted(() => ({ value: '' }))
vi.mock('@/services/ai/chat-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/ai/chat-client')>()),
  ...client,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(search.value),
}))

const ON = { config: { ai: { enabled: true } } }

beforeEach(() => {
  vi.clearAllMocks()
  search.value = ''
  client.listThreads.mockResolvedValue({ threads: [], nextOffset: null })
  client.createThread.mockResolvedValue({ id: 'new-thread' })
  client.postTurn.mockResolvedValue({ turnId: 'turn', seq: 1 })
})

describe('the chat home route', () => {
  it('creates no thread for opening a new conversation', async () => {
    renderWithProviders(<ChatPage />, ON)
    expect(await screen.findByLabelText('Ask about your data')).toBeInTheDocument()
    await waitFor(() => expect(client.listThreads).toHaveBeenCalled())
    expect(client.createThread).not.toHaveBeenCalled()
  })

  it('carries the subject in its address into the first message', async () => {
    search.value = 'about=dataset&datasetId=warehouse.sample_speeds'
    renderWithProviders(<ChatPage />, ON)
    const composer = await screen.findByPlaceholderText('Ask about warehouse.sample_speeds')
    expect(client.createThread).not.toHaveBeenCalled()
    await userEvent.type(composer, 'What is in it?{Enter}')
    await waitFor(() => expect(push).toHaveBeenCalledWith('/chat/new-thread'))
    expect(client.createThread).toHaveBeenCalledWith(
      { kind: 'dataset', datasetId: 'warehouse.sample_speeds' },
      expect.any(AbortSignal)
    )
    expect(client.postTurn).toHaveBeenCalledWith('new-thread', 'What is in it?', expect.any(AbortSignal))
  })

  it('starts a plain conversation when the subject in the address is not one', async () => {
    search.value = 'about=query&queryId=abc'
    renderWithProviders(<ChatPage />, ON)
    await userEvent.type(await screen.findByLabelText('Ask about your data'), 'hello{Enter}')
    await waitFor(() => expect(push).toHaveBeenCalledWith('/chat/new-thread'))
    expect(client.createThread).toHaveBeenCalledWith(undefined, expect.any(AbortSignal))
  })
})
