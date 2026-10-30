import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores } from '@/test/utils'
import { InviteDialog } from './invite-dialog'

afterEach(() => resetStores())

describe('InviteDialog', () => {
  it('renders name and email fields and closes from Cancel', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    renderWithProviders(
      <InviteDialog open onOpenChange={onOpenChange} onInvited={() => {}} />
    )

    expect(screen.getByRole('heading', { name: /new user/i })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/john doe/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/user@example.com/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('marks the name and email fields required', () => {
    renderWithProviders(<InviteDialog open onOpenChange={() => {}} onInvited={() => {}} />)

    expect(screen.getByText('Name').querySelector('[data-slot="required-marker"]')).not.toBeNull()
    expect(screen.getByPlaceholderText(/john doe/i)).toBeRequired()
    expect(screen.getByText('Email').querySelector('[data-slot="required-marker"]')).not.toBeNull()
    expect(screen.getByPlaceholderText(/user@example.com/i)).toBeRequired()
  })

  it('keeps the width the wrapper gave it by default', () => {
    renderWithProviders(<InviteDialog open onOpenChange={() => {}} onInvited={() => {}} />)
    const panel = screen.getByRole('dialog')
    expect(panel).toHaveAttribute('data-slot', 'dialog-content')
    // md, not the primitive's sm default: these call sites relied on the
    // wrapper's default width.
    expect(panel.className).toContain('max-w-lg')
  })

  it('posts the invite and reports the created user', async () => {
    const user = userEvent.setup()
    const onInvited = vi.fn()
    let requestBody: Record<string, unknown> | undefined
    server.use(
      http.post('/api/node/users', async ({ request }) => {
        requestBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          invite_link: 'http://redash.local/invite/token-123',
          email_sent: false,
        })
      })
    )

    renderWithProviders(
      <InviteDialog open onOpenChange={() => {}} onInvited={onInvited} />
    )

    await user.type(screen.getByPlaceholderText(/john doe/i), 'New Analyst')
    await user.type(screen.getByPlaceholderText(/user@example.com/i), 'new@example.com')
    await user.click(screen.getByRole('button', { name: /create/i }))

    await waitFor(() => expect(requestBody).toBeDefined())
    expect(requestBody).toEqual({ name: 'New Analyst', email: 'new@example.com' })
    expect(onInvited).toHaveBeenCalledOnce()
    expect(await screen.findByDisplayValue(/\/invite\/token-123$/)).toBeInTheDocument()
  })

  it('shows the user as created when the invite went by email and no link came back', async () => {
    const user = userEvent.setup()
    let posts = 0
    server.use(
      http.post('/api/node/users', () => {
        posts += 1
        return HttpResponse.json({ id: 20, name: 'New Analyst', email: 'new@example.com', email_sent: true })
      })
    )

    renderWithProviders(<InviteDialog open onOpenChange={() => {}} onInvited={() => {}} />)

    await user.type(screen.getByPlaceholderText(/john doe/i), 'New Analyst')
    await user.type(screen.getByPlaceholderText(/user@example.com/i), 'new@example.com')
    await user.click(screen.getByRole('button', { name: /create/i }))

    expect(await screen.findByText(/invitation email was sent/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^create$/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument()
    expect(posts).toBe(1)
  })
})
