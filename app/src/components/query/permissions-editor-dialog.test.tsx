import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { mockUsers } from '@/lib/mock-data'
import { server } from '@/test/msw/server'
import { Toaster } from '@/components/ui/sonner'
import { renderWithProviders, resetStores } from '@/test/utils'
import { PermissionsEditorDialog } from './permissions-editor-dialog'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

beforeEach(() => {
  server.use(
    http.get('/api/node/users', () =>
      HttpResponse.json({ count: mockUsers.length, results: mockUsers })
    ),
    // Redash returns a map of access type to grantees.
    http.get('/api/node/queries/7/acl', () => HttpResponse.json({}))
  )
})

afterEach(() => resetStores())

// Renders the real Toaster alongside the dialog rather than mocking useToast,
// so a test that cares what a permission write reports can query the DOM for
// it instead of a spy call.
function open() {
  return renderWithProviders(
    <>
      <PermissionsEditorDialog open onClose={() => {}} objectId={7} authorId={1} />
      <Toaster />
    </>
  )
}

describe('PermissionsEditorDialog', () => {
  it('renders on the dialog primitive at its configured size and closes on Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    renderWithProviders(
      <PermissionsEditorDialog open onClose={onClose} objectId={7} authorId={1} />
    )

    const panel = screen.getByRole('dialog')
    expect(panel).toHaveAttribute('data-slot', 'dialog-content')
    expect(panel.className).toContain('max-w-2xl')
    expect(screen.getByText(/manage permissions/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/search users/i)).toBeInTheDocument()
    expect(await screen.findByText(/admin@example.com/i)).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('associates the Add User search field with its label', async () => {
    open()
    expect(await screen.findByLabelText(/^add user$/i)).toBeInTheDocument()
  })

  // The list was a set of names with no stated access level, so there was no
  // way to tell what being on it meant.
  it('states what being on the list grants', async () => {
    open()
    expect(await screen.findByText(/can view and edit this query/i)).toBeInTheDocument()
  })

  // Adding a user did nothing at all: onUpdate was () => {} at both call sites,
  // so no request was ever made and nothing was reported.
  it('grants access through the ACL endpoint', async () => {
    const user = userEvent.setup()
    let granted: unknown
    server.use(
      http.post('/api/node/queries/7/acl', async ({ request }) => {
        granted = await request.json()
        return HttpResponse.json({})
      })
    )

    open()
    await user.type(screen.getByPlaceholderText(/search users/i), 'Jane')
    await user.click(await screen.findByRole('button', { name: /jane analyst.*jane@example.com/i }))

    await waitFor(() => expect(granted).toEqual({ access_type: 'modify', user_id: 2 }))
    // Scoped to sonner's own data-type="success" attribute rather than a bare
    // text query: the text reaching the DOM proves the message was shown, not
    // that it arrived as a confirmation rather than a refusal.
    await waitFor(() =>
      expect(document.querySelector('[data-sonner-toast][data-type="success"]')).toHaveTextContent(
        /can now edit this query/i
      )
    )
  })

  // The important half, and the one this migration could quietly break: a
  // permissions write that fails has to still surface its refusal after the
  // dialog moved onto the primitive. This renders the real Toaster next
  // to the dialog, not a mocked stand-in, so the assertion proves the message
  // actually reaches the screen rather than just that some function was
  // called with the right string.
  it('still reports a failed permission write after the migration', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/node/queries/7/acl', () =>
        HttpResponse.json({ message: 'Forbidden' }, { status: 403 })
      )
    )

    renderWithProviders(
      <>
        <PermissionsEditorDialog open onClose={() => {}} objectId={7} authorId={1} />
        <Toaster />
      </>
    )

    expect(screen.getByRole('dialog')).toHaveAttribute('data-slot', 'dialog-content')

    await user.type(screen.getByPlaceholderText(/search users/i), 'Jane')
    await user.click(await screen.findByRole('button', { name: /jane analyst.*jane@example.com/i }))

    // Scoped to role="alert" (a refusal is assertive) rather than a bare text
    // query: the same message is also painted by the visible toast, so an
    // unscoped query matches twice.
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/could not give jane analyst access/i)
    )
    expect(screen.queryByText(/can now edit this query/i)).not.toBeInTheDocument()
  })

  // Grantees were intersected against the paged /users list, so anyone past
  // its page limit vanished from the dialog and could not be revoked. The ACL
  // response already names them, so it is the source now.
  it('lists a grantee the users page never returned', async () => {
    server.use(
      http.get('/api/node/queries/7/acl', () =>
        HttpResponse.json({
          modify: [{ id: 9999, name: 'Offpage Person', email: 'offpage@example.com' }],
        })
      )
    )

    open()

    expect(await screen.findByText('Offpage Person')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Offpage Person' })).toBeInTheDocument()
  })

  // Redash's revoke deletes only the access type it is given and returns 200
  // either way, so revoking `modify` from someone granted `view` would report
  // success and change nothing.
  it('revokes every access type the grantee holds', async () => {
    const user = userEvent.setup()
    const revoked: unknown[] = []
    server.use(
      http.get('/api/node/queries/7/acl', () =>
        HttpResponse.json({
          view: [{ id: 2, name: 'Jane Analyst', email: 'jane@example.com' }],
          modify: [{ id: 2, name: 'Jane Analyst', email: 'jane@example.com' }],
        })
      ),
      http.delete('/api/node/queries/7/acl', async ({ request }) => {
        revoked.push(await request.json())
        return HttpResponse.json({})
      })
    )

    open()
    await user.click(await screen.findByRole('button', { name: 'Remove Jane Analyst' }))

    await waitFor(() => expect(revoked).toHaveLength(2))
    expect(revoked).toEqual(
      expect.arrayContaining([
        { access_type: 'view', user_id: 2 },
        { access_type: 'modify', user_id: 2 },
      ])
    )
  })

  // "Nobody else has access" and "we could not find out" are different answers.
  it('distinguishes a failed load from an empty list', async () => {
    server.use(
      http.get('/api/node/queries/7/acl', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 })
      )
    )

    open()
    expect(await screen.findByText(/could not load who has access/i)).toBeInTheDocument()
  })
})
