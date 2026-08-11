import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { mockUsers } from '@/lib/mock-data'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores } from '@/test/utils'
import { AdminUserList, type RedashUser } from './admin-user-list'
import { required } from '@/lib/required'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

afterEach(() => {
  resetStores()
  push.mockReset()
})

function userFixture(index: number): RedashUser {
  const user = mockUsers[index]
  return {
    ...user,
    profile_image_url: user.profile_image_url || null,
    groups: user.groups.map((id) => ({ id, name: id === 1 ? 'admin' : 'default' })),
    disabled_at: user.is_disabled ? user.updated_at : null,
    active_at: user.active_at || null,
  }
}

describe('AdminUserList', () => {
  it('renders fetched rows and replaces them from the pagination control', async () => {
    const user = userEvent.setup()
    const firstPageUser = userFixture(0)
    const secondPageUser = userFixture(1)

    server.use(
      http.get('/api/node/users', ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page'))
        return HttpResponse.json({
          count: 26,
          page,
          page_size: 25,
          results: [page === 2 ? secondPageUser : firstPageUser],
        })
      })
    )

    renderWithProviders(<AdminUserList />)

    expect(await screen.findByText(firstPageUser.name)).toBeInTheDocument()
    expect(screen.getByText(firstPageUser.email)).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /name/i })).toBeInTheDocument()

    const pageLabel = screen.getByText(/page 1 of 2/i)
    const paginator = required(pageLabel.parentElement, 'the paginator')
    await user.click(within(paginator).getAllByRole('button')[1])

    expect(await screen.findByText(secondPageUser.name)).toBeInTheDocument()
    expect(screen.queryByText(firstPageUser.name)).not.toBeInTheDocument()
    expect(screen.getByText(/page 2 of 2/i)).toBeInTheDocument()
  })

  it('shows initials instead of the Gravatar identicon Redash synthesises', async () => {
    // Redash never returns a null profile_image_url: it falls back to
    // gravatar.com/avatar/<md5(email)>?d=identicon, so the row used to take the
    // <img> branch for every user in the table.
    const row = {
      ...userFixture(0),
      profile_image_url:
        'https://www.gravatar.com/avatar/6f1ed002ab5595859014ebf0951522d9?s=40&d=identicon',
      name: 'Nick Sawinyh',
    }

    server.use(
      http.get('/api/node/users', () =>
        HttpResponse.json({ count: 1, page: 1, page_size: 25, results: [row] })
      )
    )

    const { container } = renderWithProviders(<AdminUserList />)

    expect(await screen.findByText('Nick Sawinyh')).toBeInTheDocument()
    expect(screen.getByText('NS')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })

  it('renders the filter strip as real tabs and filters the list on click', async () => {
    const user = userEvent.setup()
    const activeUser = userFixture(0)
    const pendingUser = userFixture(4)

    server.use(
      http.get('/api/node/users', ({ request }) => {
        const isPending = new URL(request.url).searchParams.get('pending') === 'true'
        return HttpResponse.json({
          count: 1,
          page: 1,
          page_size: 25,
          results: [isPending ? pendingUser : activeUser],
        })
      })
    )

    renderWithProviders(<AdminUserList />)

    expect(await screen.findByText(activeUser.name)).toBeInTheDocument()

    const tablist = screen.getByRole('tablist', { name: /filter users/i })
    const activeTab = within(tablist).getByRole('tab', { name: 'Active Users' })
    const pendingTab = within(tablist).getByRole('tab', { name: 'Pending Invitations' })
    expect(activeTab).toHaveAttribute('aria-selected', 'true')
    expect(pendingTab).toHaveAttribute('aria-selected', 'false')

    await user.click(pendingTab)

    // Base UI flips `aria-selected` on the clicked trigger the moment the
    // click is processed, whether or not our `onValueChange` also updates
    // `filter` -- an uncontrolled Tabs still tracks its own selection. So
    // waiting on it is not a race against our wiring; it is only a race
    // against React committing the click, which is normally already done
    // by the time `user.click` resolves. Bounding it short (not the
    // project's 10s default) means a real regression here fails in
    // milliseconds instead of hanging the "did aria move" question.
    await waitFor(() => expect(pendingTab).toHaveAttribute('aria-selected', 'true'), {
      timeout: 300,
    })

    // The assertion that matters, and the one a passing aria-selected check
    // cannot stand in for: switching tabs changes WHICH USERS ARE LISTED.
    // This is synchronous -- no findBy, no waitFor -- so an uncontrolled
    // Tabs (aria-selected moves, `filter` never does, no re-fetch ever
    // fires) fails immediately with a named "unable to find" error instead
    // of running out the clock.
    expect(screen.getByText(pendingUser.name)).toBeInTheDocument()
    expect(screen.queryByText(activeUser.name)).not.toBeInTheDocument()
    expect(activeTab).toHaveAttribute('aria-selected', 'false')
  })

  it('exposes the filters as tabs and moves between them with arrow keys', async () => {
    const user = userEvent.setup()
    const activeUser = userFixture(0)

    server.use(
      http.get('/api/node/users', () =>
        HttpResponse.json({ count: 1, page: 1, page_size: 25, results: [activeUser] })
      )
    )

    renderWithProviders(<AdminUserList />)

    expect(await screen.findByText(activeUser.name)).toBeInTheDocument()

    const tabs = screen.getAllByRole('tab')
    expect(tabs.length).toBeGreaterThan(1)

    tabs[0].focus()
    await user.keyboard('{ArrowRight}')
    expect(tabs[1]).toHaveFocus()
  })

  // Measured on stage: the row navigated from an onClick on the <tr> and the
  // name was a plain span, so the ONLY focusable control in a user row was
  // "Disable". A keyboard user could reach the destructive action and never the
  // person's page. Asserting the link by role is what fails if the name goes
  // back to a span; asserting the text alone would still pass.
  it('reaches the user detail page by a real link, not only a row click', async () => {
    const row = userFixture(0)

    server.use(
      http.get('/api/node/users', () =>
        HttpResponse.json({ count: 1, page: 1, page_size: 25, results: [row] })
      )
    )

    renderWithProviders(<AdminUserList />)

    const link = await screen.findByRole('link', { name: row.name })
    expect(link).toHaveAttribute('href', `/users/${row.id}`)

    // The link is the row's FIRST focusable stop, so tabbing into a row lands
    // on the person's page before it can land on any destructive row action.
    const tr = required(link.closest('tr'), 'user row')
    expect([...tr.querySelectorAll('a[href], button')][0]).toBe(link)
  })
})
