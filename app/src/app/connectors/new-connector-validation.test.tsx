import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores } from '@/test/utils'
import NewConnectorPage from '@/app/connectors/new/page'

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
    connectorId: 'town-crier',
    displayName: 'Town Crier',
    recallable: true,
    credentialSchema: {
      properties: { crier_room: { type: 'string', title: 'Room' } },
      required: ['crier_room'],
      secret: [],
      order: ['crier_room'],
    },
    contentContract: { maxLength: null, supportsMarkup: false, urlCountsAsCharacters: null, requiredFooter: null },
  },
]

let posted: unknown
let postCount = 0

beforeEach(() => {
  push.mockClear()
  posted = undefined
  postCount = 0
  server.use(
    http.get('/api/connectors/types', () => HttpResponse.json(types)),
    http.post('/api/connectors', async ({ request }) => {
      postCount += 1
      posted = await request.json()
      return HttpResponse.json({}, { status: 201 })
    })
  )
})

afterEach(() => resetStores())

async function openForm() {
  const user = userEvent.setup()
  renderWithProviders(<NewConnectorPage />)
  await user.click(await screen.findByRole('button', { name: 'Town Crier' }))
  return user
}

describe('submitting the new connector form', () => {
  it('keeps the submit button enabled while the name is empty', async () => {
    await openForm()

    expect(screen.getByRole('button', { name: 'Save and test' })).toBeEnabled()
  })

  it('flags an empty name on the field, links the message and focuses it', async () => {
    const user = await openForm()
    await user.click(screen.getByRole('button', { name: 'Save and test' }))

    const name = screen.getByRole('textbox', { name: 'Name' })
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription('Give this connector a name.')
    expect(name).toHaveFocus()
    expect(postCount).toBe(0)
  })

  it('clears the name error when the name is edited', async () => {
    const user = await openForm()
    await user.click(screen.getByRole('button', { name: 'Save and test' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'A')

    expect(screen.getByRole('textbox', { name: 'Name' })).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByText('Give this connector a name.')).toBeNull()
  })

  it('submits when Enter is pressed in a field', async () => {
    const user = await openForm()
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Agency crier')
    await user.type(screen.getByRole('textbox', { name: /Room/ }), 'market{Enter}')

    await waitFor(() => expect(posted).toMatchObject({ name: 'Agency crier' }))
    expect(postCount).toBe(1)
  })
})
