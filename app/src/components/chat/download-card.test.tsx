import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CallView } from '@/lib/chat/thread-model'
import { buildCurrentUser } from '@/stores/auth-identity'
import { useAuthStore } from '@/stores/auth-store'
import { renderWithProviders, resetStores } from '@/test/utils'
import { DownloadCard, EXPORT_NOT_ALLOWED } from './download-card'

function call(output: CallView['output'], status: CallView['status'] = 'done'): CallView {
  return { callId: 'c1', tool: 'download_result', status, target: null, output, error: output?.ok ? null : (output?.error ?? null) }
}

const READY = call({ kind: 'download', ok: true, queryId: 7, format: 'xlsx', href: '/api/node/queries/7/results.xlsx' })

function signIn(permissions: string[]) {
  useAuthStore.setState({
    isAuthenticated: true,
    currentUser: buildCurrentUser({ id: 1, name: 'Analyst', email: 'analyst@example.com', permissions }),
  })
}

beforeEach(() => {
  resetStores()
  signIn(['view_query'])
})

describe('DownloadCard', () => {
  it('links the requested format first and offers the other one', () => {
    renderWithProviders(<DownloadCard call={READY} />)
    const links = screen.getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/api/node/queries/7/results.xlsx',
      '/api/node/queries/7/results.csv',
      '/queries/7',
    ])
    expect(screen.getByRole('link', { name: /XLSX/ })).toHaveAttribute('download')
  })

  it('withholds the links of a restored card once the account may no longer export', () => {
    signIn(['view_query', 'no_export_data'])
    renderWithProviders(<DownloadCard call={READY} />)
    expect(screen.queryByRole('link', { name: /CSV|XLSX/ })).not.toBeInTheDocument()
    expect(screen.getByText(EXPORT_NOT_ALLOWED)).toBeInTheDocument()
  })

  it('says why there is no download', () => {
    renderWithProviders(<DownloadCard call={call({ kind: 'download', ok: false, error: 'Your account may not export data.' }, 'failed')} />)
    expect(screen.getByText('Your account may not export data.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /CSV/ })).not.toBeInTheDocument()
  })
})
