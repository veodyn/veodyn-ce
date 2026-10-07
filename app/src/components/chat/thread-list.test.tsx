import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/utils'
import { ThreadList } from './thread-list'

const hooks = vi.hoisted(() => ({
  threads: { current: null as unknown },
  remove: vi.fn(),
  update: vi.fn(),
  push: vi.fn(),
}))

vi.mock('@/hooks/use-chat', () => ({
  useChatThreads: () => hooks.threads.current,
  useDeleteChatThread: () => ({ mutate: hooks.remove, isPending: false }),
  useUpdateChatThread: () => ({ mutate: hooks.update }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: hooks.push }) }))

const STAMP = '2026-09-17T00:00:00Z'

function loaded(threads: { id: string; title: string }[]) {
  return {
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    data: { threads: threads.map((one) => ({ ...one, pinned: false, createdAt: STAMP, updatedAt: STAMP })) },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  hooks.threads.current = loaded([{ id: 't1', title: 'Weekly ridership' }])
})

describe('ThreadList', () => {
  it('asks before deleting a conversation and deletes only on confirm', async () => {
    renderWithProviders(<ThreadList activeId="t1" />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete Weekly ridership' }))
    expect(hooks.remove).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveTextContent('Weekly ridership')
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(hooks.remove).toHaveBeenCalledWith('t1', expect.anything())
  })

  it('does not delete when the dialog is cancelled', async () => {
    renderWithProviders(<ThreadList activeId={null} />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete Weekly ridership' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(hooks.remove).not.toHaveBeenCalled()
  })

  it('offers a retry when the list cannot be loaded', async () => {
    const refetch = vi.fn()
    hooks.threads.current = { isPending: false, isError: true, refetch, data: undefined }
    renderWithProviders(<ThreadList activeId={null} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load conversations')
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('says when there are no conversations', () => {
    hooks.threads.current = loaded([])
    renderWithProviders(<ThreadList activeId={null} />)
    expect(screen.getByText('No conversations yet.')).toBeInTheDocument()
  })

  it('marks the active conversation with the sidebar row styling', () => {
    renderWithProviders(<ThreadList activeId="t1" />)
    expect(screen.getByRole('link', { name: 'Weekly ridership' }).closest('li')).toHaveClass('bg-accent', 'font-medium')
  })
})
