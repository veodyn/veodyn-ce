import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { mockGroups } from '@/lib/mock-data'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores } from '@/test/utils'
import { GroupList } from './group-list'
import { required } from '@/lib/required'

afterEach(() => resetStores())

describe('GroupList', () => {
  it('renders fetched group rows and reports the selected row', async () => {
    const user = userEvent.setup()
    const onSelectGroup = vi.fn()
    const groups = [mockGroups[0], mockGroups[2]]

    server.use(
      http.get('/api/node/groups', () => HttpResponse.json(groups))
    )

    renderWithProviders(<GroupList onSelectGroup={onSelectGroup} />)

    expect(await screen.findByText(groups[0].name)).toBeInTheDocument()
    expect(screen.getByText(groups[1].name)).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /name/i })).toBeInTheDocument()

    await user.click(required(screen.getByText(groups[1].name).closest('tr'), 'the group row'))

    expect(onSelectGroup).toHaveBeenCalledWith(
      expect.objectContaining({ id: groups[1].id, name: groups[1].name })
    )
  })
})
