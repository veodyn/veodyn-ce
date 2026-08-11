import { useState } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { ConfigProvider } from '@/components/config/config-provider'
import {
  NEUTRAL_CONFIG,
  toClientConfig,
  type ClientConfig,
} from '@/lib/config-schema'
import { server } from '@/test/msw/server'
import { renderWithProviders } from '@/test/utils'
import type { AiDataset, GenerateSqlRequest } from '@/types/ai'
import { AiPromptBar } from './ai-prompt-bar'

const dataset: AiDataset = {
  table: 'trips',
  columns: [
    { name: 'route', type: 'string', description: 'Transit route name' },
    { name: 'boardings', type: 'integer', description: 'Passenger boardings' },
  ],
}

function clientConfig(enabled: boolean): ClientConfig {
  return {
    ...toClientConfig(NEUTRAL_CONFIG),
    ai: { enabled },
  }
}

interface EditorHarnessProps {
  enabled?: boolean
  initialSql?: string
  onGenerated?: (sql: string) => void
}

function EditorHarness({
  enabled = true,
  initialSql = 'SELECT * FROM trips',
  onGenerated,
}: EditorHarnessProps) {
  const [sql, setSql] = useState(initialSql)

  function acceptDraft(nextSql: string) {
    onGenerated?.(nextSql)
    setSql(nextSql)
  }

  return (
    <ConfigProvider value={clientConfig(enabled)}>
      <AiPromptBar dataset={dataset} currentSql={sql} onGenerated={acceptDraft} />
      <label htmlFor="sql-draft">SQL draft</label>
      <textarea id="sql-draft" value={sql} onChange={(event) => setSql(event.target.value)} />
    </ConfigProvider>
  )
}

describe('AiPromptBar', () => {
  it('puts generated SQL in the editable draft and shows its rationale', async () => {
    const user = userEvent.setup()
    const onGenerated = vi.fn()
    let received: GenerateSqlRequest | undefined
    server.use(
      http.post('/api/ai/generate-sql', async ({ request }) => {
        received = (await request.json()) as GenerateSqlRequest
        return HttpResponse.json({
          sql: 'SELECT route, sum(boardings) FROM trips GROUP BY route',
          rationale: 'Groups passenger boardings by route.',
        })
      })
    )
    renderWithProviders(<EditorHarness onGenerated={onGenerated} />)

    await user.type(screen.getByRole('textbox', { name: 'Generate SQL with AI' }), 'Boardings by route')
    await user.click(screen.getByRole('button', { name: 'Generate draft' }))

    expect(await screen.findByText('Groups passenger boardings by route.')).toBeVisible()
    expect(screen.getByLabelText('SQL draft')).toHaveValue(
      'SELECT route, sum(boardings) FROM trips GROUP BY route'
    )
    expect(screen.getByRole('textbox', { name: 'Edit with prompt' })).toBeVisible()
    expect(onGenerated).toHaveBeenCalledWith(
      'SELECT route, sum(boardings) FROM trips GROUP BY route'
    )
    expect(received).toEqual({
      prompt: 'Boardings by route',
      dataset,
      currentSql: 'SELECT * FROM trips',
    })

    await user.clear(screen.getByLabelText('SQL draft'))
    await user.type(screen.getByLabelText('SQL draft'), 'SELECT route FROM trips')
    expect(screen.getByLabelText('SQL draft')).toHaveValue('SELECT route FROM trips')
    expect(onGenerated).toHaveBeenCalledTimes(1)
  })

  it('uses the human edited SQL as context for a second prompt', async () => {
    const user = userEvent.setup()
    const requests: GenerateSqlRequest[] = []
    server.use(
      http.post('/api/ai/generate-sql', async ({ request }) => {
        const body = (await request.json()) as GenerateSqlRequest
        requests.push(body)
        return HttpResponse.json({
          sql:
            requests.length === 1
              ? 'SELECT route FROM trips'
              : 'SELECT route FROM trips ORDER BY route',
          rationale: requests.length === 1 ? 'Selects routes.' : 'Sorts the current draft.',
        })
      })
    )
    renderWithProviders(<EditorHarness />)

    await user.type(screen.getByRole('textbox', { name: 'Generate SQL with AI' }), 'List routes')
    await user.click(screen.getByRole('button', { name: 'Generate draft' }))
    await screen.findByText('Selects routes.')
    await user.clear(screen.getByLabelText('SQL draft'))
    await user.type(screen.getByLabelText('SQL draft'), 'SELECT DISTINCT route FROM trips')
    await user.type(screen.getByRole('textbox', { name: 'Edit with prompt' }), 'Sort it')
    await user.click(screen.getByRole('button', { name: 'Update draft' }))

    expect(await screen.findByText('Sorts the current draft.')).toBeVisible()
    expect(requests).toHaveLength(2)
    expect(requests[1]).toMatchObject({
      prompt: 'Sort it',
      currentSql: 'SELECT DISTINCT route FROM trips',
    })
    expect(screen.getByLabelText('SQL draft')).toHaveValue(
      'SELECT route FROM trips ORDER BY route'
    )
  })

  it('does not submit an empty prompt', async () => {
    const user = userEvent.setup()
    let requestCount = 0
    server.use(
      http.post('/api/ai/generate-sql', () => {
        requestCount += 1
        return HttpResponse.json({ sql: 'SELECT 1', rationale: 'Unexpected request.' })
      })
    )
    renderWithProviders(<EditorHarness />)

    const input = screen.getByRole('textbox', { name: 'Generate SQL with AI' })
    await user.type(input, '   {Enter}')

    expect(screen.getByRole('button', { name: 'Generate draft' })).toBeDisabled()
    expect(requestCount).toBe(0)
  })

  it('disables submit in flight and prevents a duplicate request', async () => {
    const user = userEvent.setup()
    let requestCount = 0
    let releaseRequest: (() => void) | undefined
    const pendingRequest = new Promise<void>((resolve) => {
      releaseRequest = resolve
    })
    server.use(
      http.post('/api/ai/generate-sql', async () => {
        requestCount += 1
        await pendingRequest
        return HttpResponse.json({ sql: 'SELECT route FROM trips', rationale: 'Selects routes.' })
      })
    )
    renderWithProviders(<EditorHarness />)

    const input = screen.getByRole('textbox', { name: 'Generate SQL with AI' })
    await user.type(input, 'List routes')
    await user.click(screen.getByRole('button', { name: 'Generate draft' }))

    await waitFor(() => expect(requestCount).toBe(1))
    expect(screen.getByRole('button', { name: 'Generating draft' })).toBeDisabled()
    await user.type(input, '{Enter}')
    expect(requestCount).toBe(1)

    releaseRequest?.()
    expect(await screen.findByText('Selects routes.')).toBeVisible()
  })

  it('aborts an in-flight generation on unmount so a late response cannot overwrite the editor', async () => {
    const user = userEvent.setup()
    const onGenerated = vi.fn()
    let aborted = false
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.post('/api/ai/generate-sql', async ({ request }) => {
        request.signal.addEventListener('abort', () => {
          aborted = true
        })
        await gate
        return HttpResponse.json({ sql: 'STALE DRAFT', rationale: 'A superseded draft.' })
      })
    )
    const { unmount } = renderWithProviders(<EditorHarness onGenerated={onGenerated} />)

    await user.type(screen.getByRole('textbox', { name: 'Generate SQL with AI' }), 'Boardings by route')
    await user.click(screen.getByRole('button', { name: 'Generate draft' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Generating draft' })).toBeDisabled()
    )

    unmount()

    await waitFor(() => expect(aborted).toBe(true))
    release?.()
    // The abandoned response never reaches the editor callback.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(onGenerated).not.toHaveBeenCalled()
  })

  it('drops a stale generation that resolves after a manual edit to the draft', async () => {
    const user = userEvent.setup()
    const onGenerated = vi.fn()
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.post('/api/ai/generate-sql', async () => {
        await gate
        return HttpResponse.json({ sql: 'STALE DRAFT', rationale: 'A superseded draft.' })
      })
    )
    renderWithProviders(<EditorHarness onGenerated={onGenerated} />)

    await user.type(
      screen.getByRole('textbox', { name: 'Generate SQL with AI' }),
      'Boardings by route'
    )
    await user.click(screen.getByRole('button', { name: 'Generate draft' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Generating draft' })).toBeDisabled()
    )

    // The analyst edits the editor by hand while the generation is still pending.
    await user.clear(screen.getByLabelText('SQL draft'))
    await user.type(screen.getByLabelText('SQL draft'), 'SELECT route FROM trips')

    // The older response resolves against an editor that has since moved on.
    release?.()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Generate draft' })).toBeEnabled()
    )

    // The manual edit survives: the stale draft never overwrites it.
    expect(screen.getByLabelText('SQL draft')).toHaveValue('SELECT route FROM trips')
    expect(onGenerated).not.toHaveBeenCalled()
  })

  it('shows an alert and preserves SQL when generation fails', async () => {
    const user = userEvent.setup()
    const onGenerated = vi.fn()
    server.use(
      http.post('/api/ai/generate-sql', () =>
        HttpResponse.json({ error: { id: 'E_AI_001' } }, { status: 503 })
      )
    )
    renderWithProviders(
      <EditorHarness initialSql="SELECT boardings FROM trips" onGenerated={onGenerated} />
    )

    await user.type(screen.getByRole('textbox', { name: 'Generate SQL with AI' }), 'Break this')
    await user.click(screen.getByRole('button', { name: 'Generate draft' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'AI is unavailable right now. Write SQL manually below.'
    )
    expect(screen.getByLabelText('SQL draft')).toHaveValue('SELECT boardings FROM trips')
    expect(onGenerated).not.toHaveBeenCalled()
  })

  it('renders nothing and makes no request when AI is disabled', () => {
    let requestCount = 0
    server.use(
      http.post('/api/ai/generate-sql', () => {
        requestCount += 1
        return HttpResponse.json({ sql: 'SELECT 1', rationale: 'Unexpected request.' })
      })
    )
    const { container } = renderWithProviders(
      <ConfigProvider value={clientConfig(false)}>
        <AiPromptBar dataset={dataset} currentSql="SELECT 1" onGenerated={vi.fn()} />
      </ConfigProvider>
    )

    expect(container).toBeEmptyDOMElement()
    expect(requestCount).toBe(0)
  })
})
