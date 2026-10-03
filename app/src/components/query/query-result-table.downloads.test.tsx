import { describe, expect, it } from 'vitest'
import { render as rtlRender, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import userEvent from '@testing-library/user-event'
import type { QueryResultData } from '@/lib/mock-data'
import { ResultDownloadsProvider } from '@/lib/result-downloads'
import { QueryResultTable } from './query-result-table'

function render(ui: ReactElement) {
  return rtlRender(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)
}

const DATA: QueryResultData = {
  columns: [{ name: 'route', friendly_name: 'route', type: 'string' }],
  rows: [{ route: '12' }],
}

describe('the table download capability', () => {
  it('offers no download menu and names no export url when nothing grants one', () => {
    const { container } = render(<QueryResultTable data={DATA} />)

    expect(screen.queryByRole('button', { name: /Download/ })).not.toBeInTheDocument()
    expect(container.innerHTML).not.toContain('results.xlsx')
  })

  it('offers every format a downloads prop grants', async () => {
    const user = userEvent.setup()
    render(<QueryResultTable data={DATA} downloads={{ csv: true, tsv: true, xlsxHref: '/exports/7.xlsx' }} />)

    await user.click(screen.getByRole('button', { name: /Download/ }))

    expect(await screen.findByRole('menuitem', { name: 'CSV' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'TSV' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Excel/ })).toHaveAttribute('href', '/exports/7.xlsx')
  })

  it('offers only the granted formats', async () => {
    const user = userEvent.setup()
    render(<QueryResultTable data={DATA} downloads={{ csv: false, tsv: true }} />)

    await user.click(screen.getByRole('button', { name: /Download/ }))

    expect(await screen.findByRole('menuitem', { name: 'TSV' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'CSV' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Excel/ })).not.toBeInTheDocument()
  })

  it('falls back to the downloads a surrounding provider grants', async () => {
    const user = userEvent.setup()
    render(
      <ResultDownloadsProvider value={{ csv: true, tsv: true }}>
        <QueryResultTable data={DATA} />
      </ResultDownloadsProvider>
    )

    await user.click(screen.getByRole('button', { name: /Download/ }))

    expect(await screen.findByRole('menuitem', { name: 'CSV' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Excel/ })).not.toBeInTheDocument()
  })
})
