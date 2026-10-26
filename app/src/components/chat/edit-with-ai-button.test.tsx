import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('EditWithAiButton', () => {
  it('renders nothing when AI is off', () => {
    const { container } = renderWithProviders(<EditWithAiButton dashboardId={7} />, {
      config: { ai: { enabled: false } },
    })
    expect(container).toBeEmptyDOMElement()
  })

  it('opens the chat about that dashboard without creating a thread', async () => {
    renderWithProviders(<EditWithAiButton dashboardId={7} />, { config: { ai: { enabled: true } } })
    await userEvent.click(screen.getByRole('button', { name: 'Edit with AI' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/chat?about=dashboard&dashboardId=7'))
    expect(client.createThread).not.toHaveBeenCalled()
    expect(client.postTurn).not.toHaveBeenCalled()
  })

  it('asks before leaving a dirty page and starts only on confirm', async () => {
    renderWithProviders(<EditWithAiButton dashboardId={7} isDirty />, { config: { ai: { enabled: true } } })
    await userEvent.click(screen.getByRole('button', { name: 'Edit with AI' }))
    expect(await screen.findByText('Leave without saving?')).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/chat?about=dashboard&dashboardId=7'))
  })

  it('renders nothing in mock mode, where the chat has no backend', () => {
    vi.stubEnv('NEXT_PUBLIC_REDASH_URL', '')
    const { container } = renderWithProviders(<EditWithAiButton dashboardId={7} />, { config: { ai: { enabled: true } } })
    expect(container).toBeEmptyDOMElement()
    vi.stubEnv('NEXT_PUBLIC_REDASH_URL', 'http://redash.test')
  })
})
