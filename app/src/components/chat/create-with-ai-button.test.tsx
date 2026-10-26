import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/utils'
import { CreateWithAiButton } from './create-with-ai-button'
import { CreateWithAiButton as ShimmedButton } from '@/components/ai/create-chat/create-with-ai-button'

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

describe('CreateWithAiButton', () => {
  it('renders nothing when AI is off', () => {
    const { container } = renderWithProviders(<CreateWithAiButton kind="query" />, {
      config: { ai: { enabled: false } },
    })
    expect(container).toBeEmptyDOMElement()
  })

  it.each(['query', 'dashboard', 'snippet', 'kpi', 'report', 'message'] as const)(
    'opens the chat about a new %s without creating a thread',
    async (kind) => {
      renderWithProviders(<CreateWithAiButton kind={kind} />, { config: { ai: { enabled: true } } })
      await userEvent.click(screen.getByRole('button', { name: 'Create with AI' }))
      await waitFor(() => expect(push).toHaveBeenCalledWith(`/chat?about=new&newKind=${kind}`))
      expect(client.createThread).not.toHaveBeenCalled()
      expect(client.postTurn).not.toHaveBeenCalled()
    }
  )

  it('works with the chat flag unset and offers no second chat button', () => {
    renderWithProviders(<CreateWithAiButton kind="query" />, { config: { ai: { enabled: true } } })
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByRole('link', { name: /chat/i })).not.toBeInTheDocument()
  })

  it('is served from the old path for the enterprise pack', () => {
    expect(ShimmedButton).toBe(CreateWithAiButton)
  })

  it('asks before leaving a dirty page and starts only on confirm', async () => {
    renderWithProviders(<CreateWithAiButton kind="query" isDirty />, { config: { ai: { enabled: true } } })
    await userEvent.click(screen.getByRole('button', { name: 'Create with AI' }))
    expect(await screen.findByText('Leave without saving?')).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/chat?about=new&newKind=query'))
  })

  it('renders nothing in mock mode, where the chat has no backend', () => {
    vi.stubEnv('NEXT_PUBLIC_REDASH_URL', '')
    const { container } = renderWithProviders(<CreateWithAiButton kind="query" />, { config: { ai: { enabled: true } } })
    expect(container).toBeEmptyDOMElement()
    vi.stubEnv('NEXT_PUBLIC_REDASH_URL', 'http://redash.test')
  })
})
