import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OperationPayload } from '@/lib/chat/operation-changes'
import type { OperationDraftView } from '@/lib/chat/thread-model'
import { renderWithProviders } from '@/test/utils'
import { FORK_UNFINISHED, OperationActions } from './operation-actions'
import { OperationCard } from './operation-card'

const application = vi.hoisted(() => ({
  current: {
    status: 'idle',
    error: null as string | null,
    result: null as { forkId?: number; publicUrl?: string } | null,
    apply: vi.fn(),
    finish: vi.fn(),
    retrySync: vi.fn(),
    keep: vi.fn(),
  },
}))
const live = vi.hoisted(() => ({ dashboard: { data: { id: 3, api_key: 'live-token' } as unknown } }))

vi.mock('@/hooks/use-apply-operation', () => ({ useApplyOperation: () => application.current }))
vi.mock('@/hooks/use-dashboards', () => ({ useDashboard: () => live.dashboard }))
vi.mock('@/hooks/use-queries', () => ({ useQueryById: () => ({ data: undefined }) }))

const ARCHIVE: OperationPayload = {
  op: 'archive',
  target: { kind: 'query', id: 7, name: 'Weekly revenue' },
  params: { summary: 'Archive "Weekly revenue".', consequence: 'Its alerts, its refresh schedule and widgets will be removed.' },
  destructive: true,
  snapshot: { updatedAt: 'u' },
}
const FORK: OperationPayload = {
  op: 'fork',
  target: { kind: 'query', id: 7, name: 'Weekly revenue' },
  params: { summary: 'Copy "Weekly revenue" into a new query.', copyName: 'Copy of (#7) Weekly revenue' },
  destructive: false,
}
const SHARE: OperationPayload = {
  op: 'share',
  target: { kind: 'dashboard', id: 3, name: 'Ops' },
  params: { summary: 'Create a public link to "Ops".', expiresAt: null },
  destructive: false,
}

function draft(payload: OperationPayload, promotions: OperationDraftView['promotions'] = []): OperationDraftView {
  return { id: 'd1', versions: [{ version: 1, payload }], promotions }
}

function applied(targetId: string, status = 'done') {
  return [{ id: 'p1', status, targetId, receipts: [], promotedVersion: 1 }] as unknown as OperationDraftView['promotions']
}

function renderActions(payload: OperationPayload, promotions: OperationDraftView['promotions'] = []) {
  return renderWithProviders(
    <OperationCard draft={draft(payload, promotions)} version={1}>
      <OperationActions draft={draft(payload, promotions)} version={1} onApplied={vi.fn()} />
    </OperationCard>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  application.current = {
    status: 'idle',
    error: null,
    result: null,
    apply: vi.fn(),
    finish: vi.fn(),
    retrySync: vi.fn(),
    keep: vi.fn(),
  }
})

describe('OperationCard', () => {
  it('shows the sentence and the confirm copy of a destructive operation, linked to its target', () => {
    renderActions(ARCHIVE)
    expect(screen.getByText('Archive "Weekly revenue".')).toBeInTheDocument()
    expect(screen.getByText(ARCHIVE.params.consequence as string)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Weekly revenue' })).toHaveAttribute('href', '/queries/7')
  })

  it('takes two clicks to archive, and the first one applies nothing', async () => {
    renderActions(ARCHIVE)
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }))
    expect(application.current.apply).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Archive Weekly revenue, I understand' }))
    expect(application.current.apply).toHaveBeenCalledWith({ confirmed: true, overwrite: false })
  })

  it('can back out of the confirm', async () => {
    renderActions(ARCHIVE)
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument()
    expect(application.current.apply).not.toHaveBeenCalled()
  })

  it('applies a fork in one click, disabled while it runs', async () => {
    renderActions(FORK)
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(application.current.apply).toHaveBeenCalledWith({ confirmed: false, overwrite: false })
    application.current = { ...application.current, status: 'applying' }
    renderActions(FORK)
    expect(screen.getAllByRole('button', { name: 'Apply' }).at(-1)).toBeDisabled()
  })

  it('links to the copy once the fork is applied', () => {
    renderActions(FORK, applied('41'))
    expect(screen.getByRole('link', { name: /Open the copy/ })).toHaveAttribute('href', '/queries/41/source')
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument()
  })

  it('offers Finish on a fork whose copy is still a draft, and runs only that step', async () => {
    const promotions = applied('41', 'partial')
    renderActions(FORK, promotions)
    expect(screen.getByRole('link', { name: /Open the copy/ })).toHaveAttribute('href', '/queries/41/source')
    expect(screen.getByText(FORK_UNFINISHED)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Finish' }))
    expect(application.current.finish).toHaveBeenCalledWith(promotions[0])
    expect(application.current.apply).not.toHaveBeenCalled()
  })

  it('offers no Finish once the fork is done', () => {
    renderActions(FORK, applied('41'))
    expect(screen.queryByRole('button', { name: 'Finish' })).not.toBeInTheDocument()
  })

  it('shows the created public link with a copy button', () => {
    application.current = { ...application.current, result: { publicUrl: 'https://veodyn.test/dashboards/public/new-token' } }
    renderActions(SHARE, applied('3'))
    expect(screen.getByDisplayValue('https://veodyn.test/dashboards/public/new-token')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument()
  })

  it('rebuilds the public link of a restored thread from the live token', () => {
    renderActions(SHARE, applied('3'))
    expect(screen.getByDisplayValue(`${window.location.origin}/dashboards/public/live-token`)).toBeInTheDocument()
  })

  it('says a restore landed', () => {
    renderActions({ ...ARCHIVE, op: 'restore', destructive: false, params: { summary: 'Restore it.' } }, applied('7'))
    expect(screen.getByText(/Restored/)).toBeInTheDocument()
  })
})
