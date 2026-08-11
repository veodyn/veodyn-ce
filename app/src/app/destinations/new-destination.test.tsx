import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores } from '@/test/utils'
import NewDestinationPage from '@/app/destinations/new/page'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
}))

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('@/components/shared/toast-provider', async () => {
  const actual = await vi.importActual<typeof import('@/components/shared/toast-provider')>(
    '@/components/shared/toast-provider'
  )
  return { ...actual, useToast: () => ({ error: toastError, success: toastSuccess }) }
})

// The Email default, straight off REDASH_ALERTS_DEFAULT_MAIL_SUBJECT_TEMPLATE.
const SUBJECT_DEFAULT = 'Alert: {alert_name} changed status to {state}'

// Shaped like what /api/destinations/types answers with: `required` and
// `secret` come straight off each backend plugin's configuration_schema.
const types = [
  {
    type: 'email',
    name: 'Email',
    icon: 'fa-envelope',
    configuration_schema: {
      type: 'object',
      properties: {
        addresses: { type: 'string', title: 'Email Addresses (comma-separated)' },
        subject_template: { type: 'string', title: 'Subject Template', default: SUBJECT_DEFAULT },
      },
      required: ['addresses'],
      secret: [],
    },
  },
  {
    type: 'webhook',
    name: 'Webhook',
    icon: 'fa-bolt',
    configuration_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', title: 'URL' },
        username: { type: 'string', title: 'Username' },
        password: { type: 'string', title: 'Password' },
      },
      required: ['url'],
      secret: ['password', 'url'],
    },
  },
]

let posted: unknown
let postCount = 0

beforeEach(() => {
  push.mockClear()
  toastError.mockClear()
  toastSuccess.mockClear()
  posted = undefined
  postCount = 0
  server.use(
    http.get('/api/node/destinations/types', () => HttpResponse.json(types)),
    http.post('/api/node/destinations', async ({ request }) => {
      postCount += 1
      posted = await request.json()
      return HttpResponse.json({ id: 7, name: 'Ops', type: 'email', options: {} })
    })
  )
})

afterEach(() => resetStores())

async function pickType(user: ReturnType<typeof userEvent.setup>, label: string) {
  renderWithProviders(<NewDestinationPage />)
  await user.click(await screen.findByRole('button', { name: label }))
}

describe('creating an alert destination', () => {
  it('sends the options the form shows, defaults included', async () => {
    const user = userEvent.setup()
    await pickType(user, 'Email')

    const inputs = screen.getAllByRole('textbox')
    await user.type(inputs[0], 'Ops mail')
    await user.type(inputs[1], 'ops@example.com')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    // The Subject Template default was visible in the field but never left the
    // browser, so the stored destination disagreed with the form that created it.
    await waitFor(() =>
      expect(posted).toEqual({
        name: 'Ops mail',
        type: 'email',
        options: { addresses: 'ops@example.com', subject_template: SUBJECT_DEFAULT },
      })
    )
    await waitFor(() => expect(push).toHaveBeenCalledWith('/destinations'))
  })

  it('reports a refused create and keeps what was typed', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/node/destinations', () =>
        HttpResponse.json({ message: 'Name is already taken' }, { status: 400 })
      )
    )
    await pickType(user, 'Email')

    const inputs = screen.getAllByRole('textbox')
    await user.type(inputs[0], 'Ops mail')
    await user.type(inputs[1], 'ops@example.com')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Name is already taken'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Name is already taken')
    // Still on the form, still filled in.
    expect(push).not.toHaveBeenCalled()
    expect(screen.getAllByRole('textbox')[0]).toHaveValue('Ops mail')
    expect(screen.getAllByRole('textbox')[1]).toHaveValue('ops@example.com')
  })

  it('blocks a create that omits a required field and names the field', async () => {
    const user = userEvent.setup()
    await pickType(user, 'Email')

    await user.type(screen.getAllByRole('textbox')[0], 'Ops mail')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Email Addresses (comma-separated)'
    )
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining('Email Addresses (comma-separated)')
    )
    // Nothing was sent: the backend would have refused it anyway, invisibly.
    expect(postCount).toBe(0)
    expect(push).not.toHaveBeenCalled()
  })

  it('drops the values typed into the previous type when the type changes', async () => {
    const user = userEvent.setup()
    await pickType(user, 'Email')

    await user.type(screen.getAllByRole('textbox')[0], 'Ops')
    await user.type(screen.getAllByRole('textbox')[1], 'ops@example.com')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Webhook' }))

    // Username, the one Webhook field that is not a secret, starts empty.
    expect(screen.getByLabelText('Username')).toHaveValue('')

    // URL is declared secret, so it renders as a password input rather than a
    // textbox; the label is what identifies it either way.
    await user.type(screen.getByLabelText(/^URL/), 'https://hooks.example/abc')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(posted).toBeDefined())
    // An `addresses` key here is an email-address-into-a-webhook-body bug in
    // miniature: the option belongs to a schema this destination does not have.
    expect((posted as { options: Record<string, unknown> }).options).toEqual({
      url: 'https://hooks.example/abc',
    })
  })
})
