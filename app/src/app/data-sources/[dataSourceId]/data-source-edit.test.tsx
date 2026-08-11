import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import { renderWithProviders, resetStores } from '@/test/utils'
import { mockDataSources } from '@/lib/mock-data'
import { required } from '@/lib/required'
import DataSourceEditPage from '@/app/data-sources/[dataSourceId]/page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}))

afterEach(() => resetStores())

// The route reads `params` via use(), which suspends on mount even for an
// already-resolved promise, so the render is wrapped in an awaited act() to
// flush that microtask (same idiom as app/destinations/destination-edit.test.tsx).
async function renderPage(dataSourceId: string) {
  await act(async () => {
    renderWithProviders(<DataSourceEditPage params={Promise.resolve({ dataSourceId })} />)
  })
}

/**
 * Data source 1 in the active pack is a ClickHouse source whose stored options
 * differ from the type schema's defaults on every field that has one:
 * `user` against a default of `default`, `dbname` against a default of
 * `default`. That difference is the whole point of these assertions. A form
 * seeded before the record loads does not render blanks, which would be
 * obvious; it renders the schema defaults, which look like a real
 * configuration and are one Save from becoming one. Read off the active pack
 * rather than hardcoded to one demo pack's naming.
 */
const dataSource1 = required(mockDataSources.find((d) => d.id === 1), 'data source 1')
const dataSource1User = String(required(dataSource1.options.user, 'data source 1 user option'))
const dataSource1Dbname = String(required(dataSource1.options.dbname, 'data source 1 dbname option'))

describe('the data source edit form', () => {
  it('shows the stored name, not an empty field', async () => {
    await renderPage('1')

    expect(await screen.findByLabelText('Name')).toHaveValue(dataSource1.name)
  })

  it('shows stored option values rather than the type schema defaults', async () => {
    await renderPage('1')

    // Both of these have a schema default of "default", so a form that fell
    // back to the schema would pass a mere "is not empty" check.
    expect(await screen.findByLabelText('User')).toHaveValue(dataSource1User)
    expect(screen.getByLabelText('Database Name')).toHaveValue(dataSource1Dbname)
  })

  it('says the data source is not found, instead of loading forever', async () => {
    await renderPage('9999')

    expect(await screen.findByText('Data source not found.')).toBeInTheDocument()
  })
})
