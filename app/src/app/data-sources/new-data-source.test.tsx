import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import NewDataSourcePage from '@/app/data-sources/new/page'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
}))

beforeEach(() => {
  push.mockClear()
})

afterEach(() => resetStores())

describe('the search box on the data source type picker', () => {
  it('names the field for assistive tech, not just its placeholder', async () => {
    renderWithProviders(<NewDataSourcePage />)

    // A placeholder disappears the moment someone types and is not reliably
    // announced by a screen reader, so the accessible name has to come from a
    // real label, not the placeholder text alone.
    expect(
      await screen.findByRole('textbox', { name: 'Search data source types' })
    ).toBeInTheDocument()
  })

  it('filters the type list as the query changes', async () => {
    const user = userEvent.setup()
    renderWithProviders(<NewDataSourcePage />)

    // The button's accessible name is "pg PostgreSQL" (the logo's alt text
    // plus the visible label), a pre-existing quirk of DataSourceLogo unrelated
    // to this fix, so the match is a substring rather than the exact label.
    expect(await screen.findByRole('button', { name: /MySQL/ })).toBeInTheDocument()

    await user.type(
      screen.getByRole('textbox', { name: 'Search data source types' }),
      'Postgre'
    )

    expect(screen.getByRole('button', { name: /PostgreSQL/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /MySQL/ })).not.toBeInTheDocument()
  })

  it('still opens the configuration step when a filtered type is picked', async () => {
    const user = userEvent.setup()
    renderWithProviders(<NewDataSourcePage />)

    await user.type(
      await screen.findByRole('textbox', { name: 'Search data source types' }),
      'Postgre'
    )
    await user.click(screen.getByRole('button', { name: /PostgreSQL/ }))

    expect(await screen.findByRole('heading', { name: 'New PostgreSQL Data Source' })).toBeInTheDocument()
  })
})

// The NTCIP DMS connector's community field carries a cleartext-transmission
// warning in its schema description (Task 2). Before Task 6, the form had no
// way to show any field's description, so the warning reached nobody who
// actually filled the form in. These tests exercise the real, shipped schema
// from the mock pack, not a synthetic stand-in, so a regression in either the
// schema text or the rendering breaks them.
describe('the NTCIP 1203 DMS data source form', () => {
  async function openNtcipForm() {
    const user = userEvent.setup()
    renderWithProviders(<NewDataSourcePage />)
    await user.click(await screen.findByRole('button', { name: /NTCIP 1203 DMS/ }))
    return user
  }

  it('shows the community-string cleartext warning, not just a title', async () => {
    await openNtcipForm()

    expect(
      await screen.findByText(/SNMP v1 and v2c send this in plain text on the wire/)
    ).toBeInTheDocument()
  })

  it('blocks a save with malformed JSON in the devices field and names it', async () => {
    const user = await openNtcipForm()

    await user.type(screen.getByLabelText('Name'), 'Test signs')
    // Regex, not an exact string: both fields are required, so DynamicForm
    // appends a "*" to the label text and an exact match would miss it.
    await user.type(await screen.findByLabelText(/SNMP Community String/), 'public')
    // fireEvent.change sets the value directly: userEvent.type() reads a bare
    // { as a keyboard-descriptor opener, and JSON is nothing but braces.
    fireEvent.change(screen.getByLabelText(/Devices \(JSON\)/), { target: { value: '{not valid' } })
    await user.click(screen.getByRole('button', { name: 'Create' }))

    // Two alerts are on screen at once here: DynamicForm's own inline
    // field-level error, and the page's save-blocked message. This asserts
    // the latter, since that is what proves the save was actually blocked
    // rather than merely flagged.
    expect(await screen.findByText(/Fix the invalid JSON/)).toHaveTextContent(/Devices \(JSON\)/)
    expect(push).not.toHaveBeenCalled()
  })

  it('saves once the devices JSON is fixed', async () => {
    const user = await openNtcipForm()

    await user.type(screen.getByLabelText('Name'), 'Test signs')
    await user.type(await screen.findByLabelText(/SNMP Community String/), 'public')
    fireEvent.change(screen.getByLabelText(/Devices \(JSON\)/), {
      target: { value: '[{"name": "sign-1", "host": "10.0.0.1"}]' },
    })
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(push).toHaveBeenCalled())
  })
})
