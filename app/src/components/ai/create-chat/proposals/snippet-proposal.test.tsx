import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockQuerySnippets } from '@/lib/mock-data'
import { useMockDataStore } from '@/stores/mock-data-store'
import { renderWithProviders, resetStores } from '@/test/utils'
import type { SnippetProposal } from '@/types/ai-create'
import { SnippetProposalCard } from './snippet-proposal'

const PROPOSAL: SnippetProposal = {
  kind: 'snippet',
  trigger: 'last7',
  snippet: "WHERE ts >= now() - INTERVAL 7 DAY",
  description: 'Filter to the last seven days',
}

function renderCard(onCreated = vi.fn(), onBusyChange = vi.fn()) {
  renderWithProviders(
    <SnippetProposalCard
      proposal={PROPOSAL}
      onCreated={onCreated}
      onBusyChange={onBusyChange}
    />
  )
  return { onCreated, onBusyChange }
}

function storedSnippets() {
  return useMockDataStore.getState().querySnippets
}

beforeEach(() => {
  resetStores()
  useMockDataStore.setState({
    querySnippets: mockQuerySnippets.map((snippet) => ({ ...snippet })),
  })
})

describe('SnippetProposalCard', () => {
  it('writes the edited trigger, body and description', async () => {
    const user = userEvent.setup()
    const { onCreated } = renderCard()

    const trigger = screen.getByLabelText('Trigger')
    await user.clear(trigger)
    await user.type(trigger, 'last30')
    const body = screen.getByLabelText('Snippet')
    await user.clear(body)
    await user.type(body, 'WHERE ts >= now() - INTERVAL 30 DAY')
    const description = screen.getByLabelText('Description')
    await user.clear(description)
    await user.type(description, 'Filter to the last thirty days')

    await user.click(screen.getByRole('button', { name: 'Create snippet' }))

    await waitFor(() => expect(storedSnippets()).toHaveLength(mockQuerySnippets.length + 1))
    const stored = storedSnippets().at(-1)
    expect(stored?.trigger).toBe('last30')
    expect(stored?.snippet).toBe('WHERE ts >= now() - INTERVAL 30 DAY')
    expect(stored?.description).toBe('Filter to the last thirty days')
    expect(storedSnippets().some((snippet) => snippet.trigger === 'last7')).toBe(false)
    // There is no snippet detail route, so the user stays where they are.
    expect(onCreated).toHaveBeenCalledWith(null)
  })

  it('will not create a snippet with no trigger to type', async () => {
    const user = userEvent.setup()
    const { onCreated } = renderCard()

    await user.clear(screen.getByLabelText('Trigger'))

    expect(screen.getByRole('button', { name: 'Create snippet' })).toBeDisabled()
    expect(onCreated).not.toHaveBeenCalled()
    expect(storedSnippets()).toHaveLength(mockQuerySnippets.length)
  })
})
