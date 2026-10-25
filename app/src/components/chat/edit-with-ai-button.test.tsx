import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { START_FAILED_MESSAGE } from '@/hooks/use-start-chat'
import { renderWithProviders } from '@/test/utils'
import { EditWithAiButton } from './edit-with-ai-button'

vi.stubEnv('NEXT_PUBLIC_REDASH_URL', 'http://redash.test')

const client = vi.hoisted(() => ({ createThread: vi.fn(), postTurn: vi.fn(), deleteThread: vi.fn() }))
const push = vi.hoisted(() => vi.fn())
vi.mock('@/services/ai/chat-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/ai/chat-client')>()),
  ...client,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const toastError = vi.hoisted(() => vi.fn())
vi.mock('@/components/shared/toast-provider', () => ({
  useToast: () => ({ error: toastError, success: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  client.createThread.mockResolvedValue({ id: 'about-7' })
})

describe('EditWithAiButton', () => {
  it('renders nothing when AI is off', () => {
    const { container } = renderWithProviders(<EditWithAiButton dashboardId={7} />, {
      config: { ai: { enabled: false } },
    })
    expect(container).toBeEmptyDOMElement()
  })

  it('opens a thread about that dashboard', async () => {
    renderWithProviders(<EditWithAiButton dashboardId={7} />, { config: { ai: { enabled: true } } })
    await userEvent.click(screen.getByRole('button', { name: 'Edit with AI' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/chat/about-7'))
    expect(client.createThread).toHaveBeenCalledWith({ kind: 'dashboard', dashboardId: 7 }, expect.any(AbortSignal))
    expect(client.postTurn).not.toHaveBeenCalled()
  })

  it('tells the user when the thread could not be created', async () => {
    client.createThread.mockRejectedValue(new Error('down'))
    renderWithProviders(<EditWithAiButton dashboardId={7} />, { config: { ai: { enabled: true } } })
    await userEvent.click(screen.getByRole('button', { name: 'Edit with AI' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(START_FAILED_MESSAGE))
    expect(push).not.toHaveBeenCalled()
  })

  it('asks before leaving a dirty page and starts only on confirm', async () => {
    renderWithProviders(<EditWithAiButton dashboardId={7} isDirty />, { config: { ai: { enabled: true } } })
    await userEvent.click(screen.getByRole('button', { name: 'Edit with AI' }))
    expect(await screen.findByText('Leave without saving?')).toBeInTheDocument()
    expect(client.createThread).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(push).toHaveBeenCalled())
  })

  it('renders nothing in mock mode, where the chat has no backend', () => {
    vi.stubEnv('NEXT_PUBLIC_REDASH_URL', '')
    const { container } = renderWithProviders(<EditWithAiButton dashboardId={7} />, { config: { ai: { enabled: true } } })
    expect(container).toBeEmptyDOMElement()
    vi.stubEnv('NEXT_PUBLIC_REDASH_URL', 'http://redash.test')
  })
})
