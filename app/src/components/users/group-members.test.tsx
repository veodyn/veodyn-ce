import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores } from '@/test/utils'
import { GroupMembers } from './group-members'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

afterEach(() => resetStores())

describe('GroupMembers', () => {
  it('exposes member search results as a listbox of options', async () => {
    const user = userEvent.setup()

    server.use(
      http.get('/api/node/users', () =>
        HttpResponse.json({
          count: 1,
          results: [{ id: 42, name: 'Ada Lovelace', email: 'ada@example.com' }],
        })
      )
    )

    renderWithProviders(
      <GroupMembers
        isAdmin
        isBuiltin={false}
        currentUserId={99}
        members={[]}
        onAddMember={vi.fn()}
        onRemoveMember={vi.fn()}
      />
    )

    await user.type(screen.getByRole('combobox'), 'ann')

    // base-ui mounts the popover's content into a portal one render after
    // open flips, so query for options only after the interaction settles
    // rather than synchronously on the same line.
    const options = await screen.findAllByRole('option')
    expect(options.length).toBeGreaterThan(0)
  })

  it('clears the search and removes the result row after a successful add', async () => {
    const user = userEvent.setup()
    const onAddMember = vi.fn().mockResolvedValue(undefined)

    server.use(
      http.get('/api/node/users', () =>
        HttpResponse.json({
          count: 1,
          results: [{ id: 42, name: 'Ada Lovelace', email: 'ada@example.com' }],
        })
      )
    )

    renderWithProviders(
      <GroupMembers
        isAdmin
        isBuiltin={false}
        currentUserId={99}
        members={[]}
        onAddMember={onAddMember}
        onRemoveMember={vi.fn()}
      />
    )

    const input = screen.getByPlaceholderText('Search users to add...')
    await user.type(input, 'Ada')

    const resultOption = await screen.findByRole('option', { name: /ada lovelace/i })
    await user.click(resultOption)

    expect(onAddMember).toHaveBeenCalledWith(42)
    await waitFor(() => expect(input).toHaveValue(''))
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /ada lovelace/i })).not.toBeInTheDocument()
    )
  })

  it('adds the highlighted member with the keyboard alone', async () => {
    const user = userEvent.setup()
    const onAddMember = vi.fn().mockResolvedValue(undefined)

    server.use(
      http.get('/api/node/users', () =>
        HttpResponse.json({
          count: 1,
          results: [{ id: 42, name: 'Ada Lovelace', email: 'ada@example.com' }],
        })
      )
    )

    renderWithProviders(
      <GroupMembers
        isAdmin
        isBuiltin={false}
        currentUserId={99}
        members={[]}
        onAddMember={onAddMember}
        onRemoveMember={vi.fn()}
      />
    )

    const input = screen.getByPlaceholderText('Search users to add...')
    await user.type(input, 'Ada')

    // Awaiting the option is deliberately blind to the bug: the row renders
    // either way. Only the Enter below tells a working keyboard path apart
    // from one where the popover trigger swallows the key.
    await screen.findByRole('option', { name: /ada lovelace/i })
    expect(input).toHaveFocus()

    await user.keyboard('{Enter}')

    // Asserted synchronously rather than through waitFor: cmdk calls onSelect
    // inside the keydown handler, so a working implementation has already
    // called this, and a broken one fails here in milliseconds instead of
    // waiting out the 10s global asyncUtilTimeout to reach the same answer.
    expect(onAddMember).toHaveBeenCalledWith(42)
  })

  it('keeps the search text and result row when the add fails', async () => {
    const user = userEvent.setup()
    const onAddMember = vi.fn().mockRejectedValue(new Error('Failed to add member'))

    server.use(
      http.get('/api/node/users', () =>
        HttpResponse.json({
          count: 1,
          results: [{ id: 42, name: 'Ada Lovelace', email: 'ada@example.com' }],
        })
      )
    )

    renderWithProviders(
      <GroupMembers
        isAdmin
        isBuiltin={false}
        currentUserId={99}
        members={[]}
        onAddMember={onAddMember}
        onRemoveMember={vi.fn()}
      />
    )

    const input = screen.getByPlaceholderText('Search users to add...')
    await user.type(input, 'Ada')

    const resultOption = await screen.findByRole('option', { name: /ada lovelace/i })
    await user.click(resultOption)

    await waitFor(() => expect(onAddMember).toHaveBeenCalledWith(42))

    // The add failed (the parent already surfaced a toast): the search text
    // and result row must stay in place so the admin can retry without
    // re-typing, instead of being wiped out from under them.
    expect(input).toHaveValue('Ada')
    expect(screen.getByRole('option', { name: /ada lovelace/i })).toBeInTheDocument()
  })
})
