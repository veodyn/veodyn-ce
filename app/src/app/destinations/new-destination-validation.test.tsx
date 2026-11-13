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

vi.mock('@/components/shared/toast-provider', async () => {
  const actual = await vi.importActual<typeof import('@/components/shared/toast-provider')>(
    '@/components/shared/toast-provider'
  )
  return { ...actual, useToast: () => ({ error: vi.fn(), success: vi.fn() }) }
})

const types = [
  {
    type: 'email',
    name: 'Email',
    icon: 'fa-envelope',
    configuration_schema: {
      type: 'object',
      properties: { addresses: { type: 'string', title: 'Addresses' } },
      required: ['addresses'],
      secret: [],
    },
  },
]

let posted: unknown
let postCount = 0

beforeEach(() => {
  push.mockClear()
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

async function openForm() {
  const user = userEvent.setup()
  renderWithProviders(<NewDestinationPage />)
  await user.click(await screen.findByRole('button', { name: 'Email' }))
  return user
}

describe('submitting the new destination form', () => {
  it('keeps the submit button enabled while the name is empty', async () => {
    await openForm()

    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
  })

  it('flags an empty name on the field, links the message and focuses it', async () => {
    const user = await openForm()
    await user.click(screen.getByRole('button', { name: 'Create' }))

    const name = screen.getByRole('textbox', { name: 'Name' })
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription('Give the destination a name.')
    expect(name).toHaveFocus()
    expect(postCount).toBe(0)
  })

  it('clears the name error when the name is edited', async () => {
    const user = await openForm()
    await user.click(screen.getByRole('button', { name: 'Create' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'O')

    expect(screen.getByRole('textbox', { name: 'Name' })).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByText('Give the destination a name.')).toBeNull()
  })

  it('submits when Enter is pressed in a field', async () => {
    const user = await openForm()
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Ops mail')
    await user.type(screen.getByRole('textbox', { name: /Addresses/ }), 'ops@example.com{Enter}')

    await waitFor(() => expect(posted).toMatchObject({ name: 'Ops mail' }))
    expect(postCount).toBe(1)
  })
})
