import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores } from '@/test/utils'
import ConnectorEditPage from '@/app/connectors/[connectorId]/page'
import type { Connector } from '@/types/connector'

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

const types = [
  {
    connectorId: 'town-crier',
    displayName: 'Town Crier',
    recallable: true,
    credentialSchema: {
      properties: {
        crier_token: { type: 'string', title: 'Crier API token' },
        crier_room: { type: 'string', title: 'Room' },
        crier_note: { type: 'string', title: 'Operator note' },
        crier_loud: { type: 'boolean', title: 'Ring the bell' },
        crier_repeats: { type: 'number', title: 'Repeats' },
      },
      required: ['crier_token', 'crier_room'],
      clearable: ['crier_note', 'crier_loud', 'crier_repeats'],
      secret: ['crier_token', 'crier_loud', 'crier_repeats'],
      order: ['crier_token', 'crier_room', 'crier_note', 'crier_loud', 'crier_repeats'],
    },
    contentContract: {
      maxLength: 280,
      supportsMarkup: false,
      urlCountsAsCharacters: 23,
      requiredFooter: 'Reply STOP to opt out.',
    },
  },
]

const UNTESTED: Connector = {
  connectorId: 'town-crier',
  displayName: 'Town Crier',
  name: 'Agency crier',
  recallable: true,
  configuredFields: ['crier_loud', 'crier_note', 'crier_repeats', 'crier_room', 'crier_token'],
  health: {
    delivery: 'untested',
    credentialsVerifiedAt: '2026-08-28T10:00:00Z',
    lastDeliveryAt: null,
    lastDeliveryDetail: null,
  },
}

let put: unknown
let putCount = 0

function serve(connector: Connector) {
  server.use(
    http.get('/api/connectors/types', () => HttpResponse.json(types)),
    http.get('/api/connectors/town-crier', () => HttpResponse.json(connector)),
    http.put('/api/connectors/town-crier', async ({ request }) => {
      putCount += 1
      put = await request.json()
      return HttpResponse.json(connector)
    })
  )
}

async function render() {
  await act(async () => {
    renderWithProviders(<ConnectorEditPage params={Promise.resolve({ connectorId: 'town-crier' })} />)
  })
  await screen.findByRole('button', { name: 'Save' })
}

function actionsFor(title: string) {
  return within(screen.getByRole('radiogroup', { name: `What to do with ${title}` }))
}

async function choose(user: ReturnType<typeof userEvent.setup>, title: string, option: RegExp) {
  await user.click(actionsFor(title).getByRole('radio', { name: option }))
}

async function save(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Save' }))
}

beforeEach(() => {
  push.mockClear()
  toastError.mockClear()
  toastSuccess.mockClear()
  put = undefined
  putCount = 0
  serve(UNTESTED)
})

afterEach(() => resetStores())

describe('editing a configured connector', () => {
  it('reads a connector that has never delivered as untested rather than healthy', async () => {
    await render()

    expect(await screen.findByText('Untested')).toBeInTheDocument()
    expect(screen.getByText(/Nothing has been delivered through this connector yet/)).toBeInTheDocument()
  })

  it('reports a failing channel with the detail the outcome recorded', async () => {
    serve({
      ...UNTESTED,
      health: {
        delivery: 'failing',
        credentialsVerifiedAt: '2026-08-28T10:00:00Z',
        lastDeliveryAt: '2026-08-28T11:00:00Z',
        lastDeliveryDetail: 'Town Crier could not be reached.',
      },
    })
    await render()

    expect(await screen.findByText('Failing')).toBeInTheDocument()
    expect(screen.getByText(/Town Crier could not be reached/)).toBeInTheDocument()
  })

  it('offers no input for a stored credential until the operator asks to replace it', async () => {
    await render()

    expect(screen.getByText(/never read back/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Crier API token' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('radiogroup')).toHaveLength(5)
    for (const group of screen.getAllByRole('radiogroup')) {
      expect(within(group).getByRole('radio', { name: /Keep the value this instance already holds/ })).toBeChecked()
    }
  })

  it('saves a rename on its own as an edit that names no credential at all', async () => {
    const user = userEvent.setup()
    await render()

    const nameField = (await screen.findAllByRole('textbox'))[0]
    await user.clear(nameField)
    await user.type(nameField, 'Renamed crier')
    await save(user)

    await waitFor(() => expect(put).toEqual({ name: 'Renamed crier', replace: {}, clear: [] }))
    expect(toastError).not.toHaveBeenCalled()
  })

  it('sends only the credential the operator switched to Replace', async () => {
    const user = userEvent.setup()
    await render()

    await choose(user, 'Crier API token', /Replace it with a new value/)
    await user.type(screen.getByLabelText(/^Crier API token$/), 'crier-live-rotated')
    await save(user)

    await waitFor(() =>
      expect(put).toEqual({
        name: 'Agency crier',
        replace: { crier_token: 'crier-live-rotated' },
        clear: [],
      })
    )
  })

  it('lets an optional credential be cleared, which omission never could', async () => {
    const user = userEvent.setup()
    await render()

    await choose(user, 'Operator note', /Clear it/)
    await save(user)

    await waitFor(() => expect(put).toEqual({ name: 'Agency crier', replace: {}, clear: ['crier_note'] }))
  })

  it('offers no Clear for a credential the connector requires', async () => {
    await render()

    expect(actionsFor('Crier API token').queryByRole('radio', { name: /Clear it/ })).not.toBeInTheDocument()
    expect(actionsFor('Operator note').getByRole('radio', { name: /Clear it/ })).toBeInTheDocument()
  })

  it('blocks a Replace the operator left empty rather than sending a blank', async () => {
    const user = userEvent.setup()
    await render()

    await choose(user, 'Room', /Replace it with a new value/)
    await save(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Room')
    expect(putCount).toBe(0)
  })

  it('sends a boolean the operator left unchecked as false, not as a keep', async () => {
    const user = userEvent.setup()
    await render()

    await choose(user, 'Ring the bell', /Replace it with a new value/)
    await save(user)

    await waitFor(() => expect(put).toEqual({ name: 'Agency crier', replace: { crier_loud: false }, clear: [] }))
  })

  it('renders a declared boolean as a checkbox even though the schema calls it secret', async () => {
    const user = userEvent.setup()
    await render()

    await choose(user, 'Ring the bell', /Replace it with a new value/)
    expect(screen.getByRole('checkbox', { name: 'Ring the bell' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Ring the bell' })).not.toBeInTheDocument()
  })

  it('blocks a cleared number box rather than sending it as zero', async () => {
    const user = userEvent.setup()
    await render()

    await choose(user, 'Repeats', /Replace it with a new value/)
    await user.type(screen.getByLabelText(/^Repeats$/), '3')
    await user.clear(screen.getByLabelText(/^Repeats$/))
    await save(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Repeats')
    expect(putCount).toBe(0)
  })

  it('sends a number the operator typed as a number', async () => {
    const user = userEvent.setup()
    await render()

    await choose(user, 'Repeats', /Replace it with a new value/)
    await user.type(screen.getByLabelText(/^Repeats$/), '3')
    await save(user)

    await waitFor(() => expect(put).toEqual({ name: 'Agency crier', replace: { crier_repeats: 3 }, clear: [] }))
  })

  it('demands a required credential that has never been configured', async () => {
    const user = userEvent.setup()
    serve({ ...UNTESTED, configuredFields: ['crier_room'] })
    await render()

    await save(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Crier API token')
    expect(putCount).toBe(0)
  })
})
