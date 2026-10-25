import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/utils'
import { AskAboutThis } from './ask-about-this'

vi.stubEnv('NEXT_PUBLIC_REDASH_URL', 'http://redash.test')

const client = vi.hoisted(() => ({ createThread: vi.fn(), postTurn: vi.fn(), deleteThread: vi.fn() }))
const push = vi.hoisted(() => vi.fn())
vi.mock('@/services/ai/chat-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/ai/chat-client')>()),
  ...client,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const ON = { config: { ai: { enabled: true } } }

beforeEach(() => {
  vi.clearAllMocks()
  client.createThread.mockResolvedValue({ id: 'new-thread' })
})

describe('AskAboutThis', () => {
  it('renders nothing when AI is off altogether', () => {
    renderWithProviders(<AskAboutThis subject={{ kind: 'query', queryId: 7 }} label="Rail boardings" />, {
      config: { ai: { enabled: false } },
    })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('names the object for a screen reader', () => {
    renderWithProviders(<AskAboutThis subject={{ kind: 'query', queryId: 7 }} label="Rail boardings" />, ON)
    expect(screen.getByRole('button', { name: 'Ask about Rail boardings in chat' })).toBeInTheDocument()
  })

  it('opens a thread about the object', async () => {
    const subject = { kind: 'widget', dashboardId: 4, widgetId: 21 } as const
    renderWithProviders(<AskAboutThis subject={subject} label="Trend" />, ON)
    await userEvent.click(screen.getByRole('button', { name: 'Ask about Trend in chat' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/chat/new-thread'))
    expect(client.createThread).toHaveBeenCalledWith(subject, expect.any(AbortSignal))
    expect(client.postTurn).not.toHaveBeenCalled()
  })

  it('starts directly when the page is clean', async () => {
    renderWithProviders(<AskAboutThis subject={{ kind: 'query', queryId: 7 }} label="Rail" isDirty={false} />, ON)
    await userEvent.click(screen.getByRole('button', { name: 'Ask about Rail in chat' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/chat/new-thread'))
  })

  it('asks before leaving a dirty page and starts only on confirm', async () => {
    renderWithProviders(<AskAboutThis subject={{ kind: 'query', queryId: 7 }} label="Rail" isDirty />, ON)
    await userEvent.click(screen.getByRole('button', { name: 'Ask about Rail in chat' }))
    expect(await screen.findByText('Leave without saving?')).toBeInTheDocument()
    expect(client.createThread).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/chat/new-thread'))
  })

  it('does nothing when the user keeps editing', async () => {
    renderWithProviders(<AskAboutThis subject={{ kind: 'query', queryId: 7 }} label="Rail" isDirty />, ON)
    await userEvent.click(screen.getByRole('button', { name: 'Ask about Rail in chat' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Keep editing' }))
    expect(client.createThread).not.toHaveBeenCalled()
  })
})
