import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatDraftCardProps } from '@/features/chat-draft-types'
import type { ChatPromotion } from '@/lib/chat/wire'
import { renderWithProviders } from '@/test/utils'

const applySnippetCreate = vi.hoisted(() => vi.fn())
const applySnippetEdit = vi.hoisted(() => vi.fn())

vi.mock('@/lib/chat/snippet-apply', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/chat/snippet-apply')>()),
  applySnippetCreate,
  applySnippetEdit,
}))

import SnippetDraftCard from './snippet-draft-card'
import SnippetEditCard from './snippet-edit-card'

const DONE = {
  id: 'p1',
  targetType: 'snippet',
  targetId: '9',
  promotedVersion: 1,
  targetVersionAtPromote: null,
  status: 'done',
  receipts: [],
  createdAt: 'x',
  updatedAt: 'x',
} as ChatPromotion

function props(payload: unknown, extra: Partial<ChatDraftCardProps> = {}): ChatDraftCardProps {
  return {
    threadId: 't1',
    draftId: 'd1',
    version: 1,
    payload,
    promotions: [],
    queryDrafts: {},
    queryDraftSync: {},
    onPromoted: vi.fn(),
    onQueryDraftPromoted: vi.fn(),
    holdQueryDraftSync: vi.fn(),
    retryQueryDraftSync: vi.fn(),
    ...extra,
  }
}

const CREATE = { trigger: 'dt', snippet: "date_trunc('day', ts)", description: 'Truncate to a day' }
const SNAPSHOT = { trigger: 'dt', snippet: 'old body', description: '', updatedAt: 's' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('snippet draft card', () => {
  it('shows the trigger, the text and the description, and saves on Save', async () => {
    applySnippetCreate.mockResolvedValue({ status: 'done', promotion: DONE })
    const card = props(CREATE)
    renderWithProviders(<SnippetDraftCard {...card} />)
    expect(screen.getByText('dt')).toBeInTheDocument()
    expect(screen.getByText("date_trunc('day', ts)")).toBeInTheDocument()
    expect(screen.getByText('Truncate to a day')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(card.onPromoted).toHaveBeenCalledWith(DONE))
    expect(applySnippetCreate).toHaveBeenCalledWith('d1', 1, CREATE)
  })

  it('shows the failure and keeps the proposal when the save is refused', async () => {
    applySnippetCreate.mockResolvedValue({ status: 'failed', error: 'trigger already exists' })
    renderWithProviders(<SnippetDraftCard {...props(CREATE)} />)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('trigger already exists')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('links to the snippets once it is saved and offers no second Save', () => {
    renderWithProviders(<SnippetDraftCard {...props(CREATE, { promotions: [DONE] })} />)
    expect(screen.getByRole('link', { name: /Saved/ })).toHaveAttribute('href', '/query-snippets')
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('draws nothing it cannot read', () => {
    const { container } = renderWithProviders(<SnippetDraftCard {...props({ nope: true })} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('snippet edit card', () => {
  const EDIT = { snippetId: 3, snapshot: SNAPSHOT, changes: { snippet: 'new body', description: 'Now described' } }

  it('shows before and after for each changed field and applies the edit', async () => {
    applySnippetEdit.mockResolvedValue({ status: 'done', promotion: { ...DONE, targetId: '3' } })
    const card = props(EDIT)
    renderWithProviders(<SnippetEditCard {...card} />)
    expect(screen.getByText('old body')).toBeInTheDocument()
    expect(screen.getByText('new body')).toBeInTheDocument()
    expect(screen.getByText('Now described')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(card.onPromoted).toHaveBeenCalled())
    expect(applySnippetEdit).toHaveBeenCalledWith('d1', 1, EDIT, { overwrite: false })
  })

  it('asks before overwriting a snippet that changed after the chat read it', async () => {
    applySnippetEdit.mockResolvedValueOnce({ status: 'conflict' })
    applySnippetEdit.mockResolvedValueOnce({ status: 'done', promotion: DONE })
    renderWithProviders(<SnippetEditCard {...props(EDIT)} />)
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('changed after the chat read it')

    await userEvent.click(screen.getByRole('button', { name: 'Overwrite' }))

    await waitFor(() => expect(applySnippetEdit).toHaveBeenLastCalledWith('d1', 1, EDIT, { overwrite: true }))
  })

  it('needs a second click to delete', async () => {
    applySnippetEdit.mockResolvedValue({ status: 'done', promotion: DONE })
    const card = props({ snippetId: 3, snapshot: SNAPSHOT, changes: {}, delete: true })
    renderWithProviders(<SnippetEditCard {...card} />)

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(applySnippetEdit).not.toHaveBeenCalled()
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete it' }))

    await waitFor(() => expect(card.onPromoted).toHaveBeenCalled())
    expect(applySnippetEdit.mock.calls[0][2]).toMatchObject({ delete: true })
  })

  it('backs out of a delete without calling anything', async () => {
    renderWithProviders(<SnippetEditCard {...props({ snippetId: 3, snapshot: SNAPSHOT, changes: {}, delete: true })} />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(applySnippetEdit).not.toHaveBeenCalled()
  })

  it('says the snippet is deleted once the promotion is recorded', () => {
    renderWithProviders(
      <SnippetEditCard
        {...props({ snippetId: 3, snapshot: SNAPSHOT, changes: {}, delete: true }, { promotions: [{ ...DONE, targetId: '3' }] })}
      />
    )
    expect(screen.getByText('Deleted.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })
})
