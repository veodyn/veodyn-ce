import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores } from '@/test/utils'
import DestinationEditPage from '@/app/destinations/[destinationId]/page'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}))

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('@/components/shared/toast-provider', async () => {
  const actual = await vi.importActual<typeof import('@/components/shared/toast-provider')>(
    '@/components/shared/toast-provider'
  )
  return { ...actual, useToast: () => ({ error: toastError, success: toastSuccess }) }
})

// The wire shapes, not a convenient invention. `to_dict()` returns id, name,
// type and icon; `options` is added only under `all=True`, which is what the
// single-destination read passes and the list does not. A test whose list
// carries options cannot see the bug where the form reads the list.
const listItem = { id: 3, name: 'Ops mail', type: 'email', icon: 'fa-envelope' }

// The detail read masks secrets: Redash sends `--------` in place of the
// stored value, and expects that exact string back if the secret is unchanged.
const MASK = '--------'
const detail = {
  ...listItem,
  options: { addresses: 'ops@example.com', api_key: MASK },
}

const types = [
  {
    type: 'email',
    name: 'Email',
    icon: 'fa-envelope',
    configuration_schema: {
      type: 'object',
      properties: {
        addresses: { type: 'string', title: 'Email Addresses (comma-separated)' },
        api_key: { type: 'string', title: 'API Key' },
      },
      required: ['addresses'],
      secret: ['api_key'],
    },
  },
]

let posted: Record<string, unknown> | undefined
let postCount = 0
let listGets = 0
let detailGets = 0

// DestinationResource.post reads req["type"], req["name"] and req["options"]
// straight out of the body with no require_fields guard, so a missing key is a
// KeyError and Flask answers 500 having written nothing. Modelled here so a
// body the real backend would reject fails the test instead of passing.
const REQUIRED_BY_BACKEND = ['type', 'name', 'options']

function postDestination() {
  return http.post('/api/node/destinations/3', async ({ request }) => {
    postCount += 1
    const body = (await request.json()) as Record<string, unknown>
    posted = body
    const missing = REQUIRED_BY_BACKEND.find((field) => body[field] === undefined)
    if (missing) {
      return HttpResponse.json({ message: `KeyError: '${missing}'` }, { status: 500 })
    }
    return HttpResponse.json({ ...detail, name: body.name, options: body.options })
  })
}

beforeEach(() => {
  toastError.mockClear()
  toastSuccess.mockClear()
  posted = undefined
  postCount = 0
  listGets = 0
  detailGets = 0
  server.use(
    http.get('/api/node/destinations/types', () => HttpResponse.json(types)),
    http.get('/api/node/destinations', () => {
      listGets += 1
      return HttpResponse.json([listItem])
    }),
    http.get('/api/node/destinations/3', () => {
      detailGets += 1
      return HttpResponse.json(detail)
    }),
    postDestination()
  )
})

afterEach(() => resetStores())

async function renderPage() {
  // The route reads `params` via use(), which suspends on mount even for an
  // already-resolved promise, so the render is wrapped in an awaited act() to
  // flush that microtask (same idiom as app/kpis/[kpiId]/page.test.tsx).
  await act(async () => {
    renderWithProviders(<DestinationEditPage params={Promise.resolve({ destinationId: '3' })} />)
  })
}

async function loadedNameInput(): Promise<HTMLElement> {
  const input = await screen.findByLabelText('Name')
  await waitFor(() => expect(input).toHaveValue('Ops mail'))
  return input
}

// DynamicForm's labels are not associated with their inputs, so the config
// fields are reached by position: [0] is the destination name, [1] the first
// schema field. The secret renders as type=password and has no textbox role.
function addressesInput(): HTMLElement {
  return screen.getAllByRole('textbox')[1]
}

describe('editing an alert destination', () => {
  it('reads the destination that carries options, not the list that omits them', async () => {
    await renderPage()

    await loadedNameInput()
    await waitFor(() => expect(addressesInput()).toHaveValue('ops@example.com'))

    // Which endpoint answered is the whole point: the list has no options to
    // give, so a form fed from it shows a blank config and saves the blank.
    expect(detailGets).toBeGreaterThan(0)
    expect(listGets).toBe(0)
  })

  it('sends the type the backend reads before it writes anything', async () => {
    const user = userEvent.setup()
    await renderPage()
    const nameInput = await loadedNameInput()
    await waitFor(() => expect(addressesInput()).toHaveValue('ops@example.com'))

    await user.clear(nameInput)
    await user.type(nameInput, 'Ops mail (EU)')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(posted).toEqual({
        name: 'Ops mail (EU)',
        type: 'email',
        options: { addresses: 'ops@example.com', api_key: MASK },
      })
    )
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    expect(toastError).not.toHaveBeenCalled()
  })

  it('returns a masked secret unchanged so the stored credential survives', async () => {
    const user = userEvent.setup()
    await renderPage()
    await loadedNameInput()
    await waitFor(() => expect(addressesInput()).toHaveValue('ops@example.com'))

    await user.clear(addressesInput())
    await user.type(addressesInput(), 'eu-ops@example.com')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // ConfigurationContainer.update() swaps this exact placeholder back for the
    // stored value. Sending anything else here, or dropping the key, replaces a
    // working credential with the mask or with nothing.
    await waitFor(() =>
      expect(posted?.options).toEqual({ addresses: 'eu-ops@example.com', api_key: MASK })
    )
  })

  it('reports a refused save instead of looking saved', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/node/destinations/3', () =>
        HttpResponse.json({ message: 'Forbidden' }, { status: 403 })
      )
    )
    await renderPage()
    await loadedNameInput()

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Forbidden'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden')
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('blocks a save that empties a required field and names it', async () => {
    const user = userEvent.setup()
    await renderPage()
    await loadedNameInput()
    await waitFor(() => expect(addressesInput()).toHaveValue('ops@example.com'))

    await user.clear(addressesInput())
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Email Addresses (comma-separated)')
    expect(postCount).toBe(0)
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('says not found for a destination the backend does not have', async () => {
    server.use(
      http.get('/api/node/destinations/3', () =>
        HttpResponse.json({ message: 'Not found' }, { status: 404 })
      )
    )
    await renderPage()

    expect(await screen.findByText('Destination not found.')).toBeInTheDocument()
  })

  it('distinguishes a failed read from a missing destination', async () => {
    server.use(
      http.get('/api/node/destinations/3', () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 })
      )
    )
    await renderPage()

    expect(await screen.findByText(/Unable to load this destination/)).toBeInTheDocument()
  })
})
