import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/utils'
import { CHAT_OFF_MESSAGE, ChatShell } from './chat-shell'

const client = vi.hoisted(() => ({ listThreads: vi.fn() }))
vi.mock('@/services/ai/chat-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/ai/chat-client')>()),
  ...client,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const STAMP = '2026-09-17T00:00:00Z'

beforeEach(() => {
  client.listThreads.mockResolvedValue({
    threads: [
      { id: 't1', title: 'Speeds', pinned: true, createdAt: STAMP, updatedAt: STAMP, lastTurnAt: STAMP },
      { id: 't2', title: '', pinned: false, createdAt: STAMP, updatedAt: STAMP, lastTurnAt: STAMP },
    ],
    nextOffset: null,
  })
})

describe('ChatShell', () => {
  it('says chat is off and loads nothing', () => {
    renderWithProviders(<ChatShell activeId={null}>body</ChatShell>, { config: { ai: { enabled: true, chat: false } } })
    expect(screen.getByText(CHAT_OFF_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByText('body')).not.toBeInTheDocument()
    expect(client.listThreads).not.toHaveBeenCalled()
  })

  it('lists conversations beside the page when chat is on', async () => {
    renderWithProviders(<ChatShell activeId="t1">body</ChatShell>, { config: { ai: { enabled: true, chat: true } } })
    expect(screen.getByText('body')).toBeInTheDocument()
    const active = await screen.findByRole('link', { name: /Speeds/ })
    expect(active).toHaveAttribute('aria-current', 'page')
    expect(active).toHaveAttribute('href', '/chat/t1')
    const [start, untitled] = screen.getAllByRole('link', { name: 'New conversation' })
    expect(start).toHaveAttribute('href', '/chat')
    expect(untitled).toHaveAttribute('href', '/chat/t2')
    expect(screen.getByRole('button', { name: 'Unpin Speeds' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete New conversation' })).toBeInTheDocument()
  })
})
