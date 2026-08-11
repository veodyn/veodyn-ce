import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders, resetStores } from '@/test/utils'
import { GroupList } from './group-list'
import { groupRow, serveGroupList, signInAsAdmin, signInAsMember } from './users-admin-fixtures'

afterEach(() => resetStores())

const DATA_TEAM = groupRow({ id: 3, name: 'Data Team', type: 'regular' })
const BUILTIN = groupRow({ id: 1, name: 'admin', type: 'builtin' })

const newGroup = () => screen.queryByRole('button', { name: /new group/i })
const deleteControl = (name: string) => screen.queryByRole('button', { name: `Delete ${name}` })

describe('GroupList permission surface', () => {
  it('shows a normal member the groups and no way to create or delete one', async () => {
    signInAsMember()
    serveGroupList([DATA_TEAM, BUILTIN])
    renderWithProviders(<GroupList onSelectGroup={vi.fn()} />)

    // Positive first: both rows are on screen, so the absences below are about
    // permission and not about a list that never loaded.
    expect(await screen.findByText('Data Team')).toBeInTheDocument()
    expect(screen.getByText('admin')).toBeInTheDocument()
    // Members is not admin-gated: everyone can open a group to see who is in it.
    expect(screen.getAllByRole('button', { name: 'Members' })).toHaveLength(2)

    expect(newGroup()).not.toBeInTheDocument()
    expect(deleteControl('Data Team')).not.toBeInTheDocument()
    expect(deleteControl('admin')).not.toBeInTheDocument()
  })

  it('gives an admin the create button and a delete on regular groups only', async () => {
    signInAsAdmin()
    serveGroupList([DATA_TEAM, BUILTIN])
    renderWithProviders(<GroupList onSelectGroup={vi.fn()} />)

    expect(await screen.findByText('Data Team')).toBeInTheDocument()
    expect(newGroup()).toBeInTheDocument()
    expect(deleteControl('Data Team')).toBeInTheDocument()

    // The built-in groups are Redash's own: deleting one takes every
    // permission in the instance with it. The row still renders and is still
    // marked, it just carries no delete.
    expect(screen.getByText('admin')).toBeInTheDocument()
    expect(screen.getByText('built-in')).toBeInTheDocument()
    expect(deleteControl('admin')).not.toBeInTheDocument()
  })

  it('names the delete control after the group it deletes', async () => {
    signInAsAdmin()
    serveGroupList([DATA_TEAM])
    renderWithProviders(<GroupList onSelectGroup={vi.fn()} />)

    // An icon-only destructive control in a table of near-identical rows: the
    // accessible name has to say WHICH group, not just "Delete", or a screen
    // reader user hears the same label on every row.
    const control = await screen.findByRole('button', { name: 'Delete Data Team' })
    expect(control).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })
})
