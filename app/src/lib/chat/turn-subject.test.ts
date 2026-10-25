import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENDPOINT, THREAD, json, mockChatModules, signedIn, unmockChatModules } from './relay-test-harness'

const TURN = '0b8e2a54-3a8e-4f43-9d4f-5d1c8f7a2b10'

afterEach(() => {
  vi.doUnmock('./turn-context-builder')
  unmockChatModules()
})

const QUERY = {
  id: 7,
  name: 'Rail boardings',
  can_edit: true,
  data_source_id: 3,
  query: 'select 1',
  schedule: null,
  options: { parameters: [] },
  visualizations: [],
}

function setup(options: { subject: unknown; nodeStatus?: number; subjectStatus?: number }) {
  mockChatModules()
  const redashFetch = vi.fn(async () =>
    options.nodeStatus && options.nodeStatus !== 200 ? new Response('{}', { status: options.nodeStatus }) : json(QUERY)
  )
  vi.doMock('@/lib/redash-server', () => ({ requireSession: vi.fn(async () => ({ id: 7 })), redashFetch }))
  vi.doMock('./turn-context-builder', () => ({ buildTurnContext: async () => ({}) }))
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith('/subject')) {
      return options.subjectStatus && options.subjectStatus !== 200
        ? new Response('{}', { status: options.subjectStatus })
        : json({ subject: options.subject })
    }
    return json({ turnId: TURN, seq: 1 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { redashFetch, fetchMock }
}

async function postTurn() {
  const { POST } = await import('@/app/api/ai/chat/threads/[id]/turns/route')
  const response = await POST(
    signedIn({ method: 'POST', url: `http://localhost/api/ai/chat/threads/${THREAD}/turns`, body: JSON.stringify({ text: 'what is this?' }) }),
    { params: Promise.resolve({ id: THREAD }) }
  )
  return response
}

function turnBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/turns'))
  if (!call) throw new Error('no turn was posted')
  return JSON.parse(String((call[1] as RequestInit).body))
}

describe('turn route subject detail', () => {
  it('reads the thread subject from the sidecar and sends its current state with the turn', async () => {
    const { fetchMock, redashFetch } = setup({ subject: { kind: 'query', queryId: 7 } })
    const response = await postTurn()
    expect(response.status).toBe(200)
    expect(fetchMock.mock.calls[0][0]).toBe(`${ENDPOINT}/chat/threads/${THREAD}/subject`)
    expect(redashFetch).toHaveBeenCalledWith('/api/queries/7', expect.objectContaining({ cookie: expect.stringContaining('session=s') }))
    expect(turnBody(fetchMock)).toMatchObject({
      text: 'what is this?',
      subjectDetail: { kind: 'query', id: '7', name: 'Rail boardings', canEdit: true },
    })
  })

  it('sends no block and no error when the user can no longer read the subject', async () => {
    const { fetchMock } = setup({ subject: { kind: 'query', queryId: 7 }, nodeStatus: 403 })
    const response = await postTurn()
    expect(response.status).toBe(200)
    expect(turnBody(fetchMock)).not.toHaveProperty('subjectDetail')
  })

  it('behaves as before for a thread with no subject', async () => {
    const { fetchMock, redashFetch } = setup({ subject: null })
    const response = await postTurn()
    expect(response.status).toBe(200)
    expect(redashFetch).not.toHaveBeenCalled()
    expect(turnBody(fetchMock)).not.toHaveProperty('subjectDetail')
  })

  it('still sends the turn when the sidecar cannot answer the subject read', async () => {
    const { fetchMock } = setup({ subject: { kind: 'query', queryId: 7 }, subjectStatus: 500 })
    const response = await postTurn()
    expect(response.status).toBe(200)
    expect(turnBody(fetchMock)).not.toHaveProperty('subjectDetail')
  })

  it('sends a new-object subject without reading node', async () => {
    const { fetchMock, redashFetch } = setup({ subject: { kind: 'new', newKind: 'dashboard' } })
    await postTurn()
    expect(redashFetch).not.toHaveBeenCalled()
    expect(turnBody(fetchMock)).toMatchObject({ subjectDetail: { kind: 'new', id: 'dashboard', name: 'dashboard', lines: [] } })
  })
})
