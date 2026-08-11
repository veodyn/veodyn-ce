/**
 * Configuring a parameter. Writing `{{ route_id }}` in the SQL creates one, but
 * it arrives as plain text: without this dialog every parameter is a text box,
 * so an enum means typing a value that has to match an option exactly and a
 * date means typing an ISO string by hand.
 *
 * The keyword is deliberately read-only. Renaming it in Redash rewrites the SQL
 * that references it, and a rename here that left the SQL alone would delete the
 * parameter on the next sync (its old name is gone from the text) and silently
 * create a fresh one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockQueries, type MockQueryParameter } from '@/lib/mock-data'
import { useMockDataStore } from '@/stores/mock-data-store'
import { renderWithProviders, resetStores } from '@/test/utils'
import { ParameterSettingsDialog } from './parameter-settings-dialog'

const TEXT_PARAM: MockQueryParameter = {
  name: 'route_id',
  title: 'route_id',
  type: 'text',
  value: null,
}

function renderDialog(parameter: MockQueryParameter = TEXT_PARAM) {
  const onSave = vi.fn()
  renderWithProviders(
    <ParameterSettingsDialog
      open
      parameter={parameter}
      onClose={vi.fn()}
      onSave={onSave}
    />
  )
  return onSave
}

async function chooseType(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByLabelText('Type'))
  await user.click(await screen.findByRole('option', { name: label }))
}

async function save(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Save' }))
}

beforeEach(() => resetStores())
afterEach(() => {
  resetStores()
  useMockDataStore.setState({ queries: mockQueries })
})

describe('the parameter settings dialog', () => {
  it('shows the keyword the SQL uses, without offering to change it', () => {
    renderDialog()

    expect(screen.getByText('route_id')).toBeInTheDocument()
    expect(screen.queryByLabelText('Keyword')).not.toBeInTheDocument()
  })

  it('saves a new title', async () => {
    const user = userEvent.setup()
    const onSave = renderDialog()

    await user.clear(screen.getByLabelText('Title'))
    await user.type(screen.getByLabelText('Title'), 'Route')
    await save(user)

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'Route' }))
  })

  it('offers the dropdown values field only once the type is a dropdown', async () => {
    const user = userEvent.setup()
    renderDialog()

    expect(screen.queryByLabelText('Values')).not.toBeInTheDocument()

    await chooseType(user, 'Dropdown List')

    expect(await screen.findByLabelText('Values')).toBeInTheDocument()
  })

  it('saves the dropdown values as the newline-delimited list Redash stores', async () => {
    const user = userEvent.setup()
    const onSave = renderDialog()

    await chooseType(user, 'Dropdown List')
    await user.type(await screen.findByLabelText('Values'), 'Open{enter}Closed')
    await save(user)

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'enum', enumOptions: 'Open\nClosed' })
    )
  })

  it('lets a query-backed dropdown pick the query it reads', async () => {
    const user = userEvent.setup()
    useMockDataStore.setState({
      queries: [{ ...mockQueries[0], id: 77, name: 'Route list' }],
    })
    const onSave = renderDialog()

    await chooseType(user, 'Query Based Dropdown List')
    await user.click(await screen.findByLabelText('Query'))
    await user.click(await screen.findByRole('option', { name: 'Route list' }))
    await save(user)

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'query', queryId: 77 })
    )
  })

  // multiValuesOptions is both the switch and the quoting. Its presence is what
  // marks the parameter as multi-value for the backend.
  it('turns on multiple values with the chosen quotation', async () => {
    const user = userEvent.setup()
    const onSave = renderDialog({ ...TEXT_PARAM, type: 'enum', enumOptions: 'A\nB' })

    await user.click(screen.getByRole('switch', { name: 'Allow multiple values' }))
    await user.click(await screen.findByLabelText('Quotation'))
    await user.click(await screen.findByRole('option', { name: 'Single quotation mark' }))
    await save(user)

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        multiValuesOptions: { prefix: "'", suffix: "'", separator: ',' },
      })
    )
  })

  it('drops the multi-value marker when the switch goes off', async () => {
    const user = userEvent.setup()
    const onSave = renderDialog({
      ...TEXT_PARAM,
      type: 'enum',
      enumOptions: 'A\nB',
      multiValuesOptions: { prefix: "'", suffix: "'", separator: ',' },
    })

    await user.click(screen.getByRole('switch', { name: 'Allow multiple values' }))
    await save(user)

    expect(onSave.mock.calls[0][0].multiValuesOptions).toBeUndefined()
  })

  // Only enum and query dropdowns can hold several values in Redash.
  it('does not offer multiple values for a date parameter', async () => {
    const user = userEvent.setup()
    renderDialog()

    await chooseType(user, 'Date')

    expect(screen.queryByRole('switch', { name: 'Allow multiple values' })).not.toBeInTheDocument()
  })

  // Switching away from a dropdown has to take its options with it, or the
  // parameter carries settings its type cannot use.
  it('clears dropdown settings when the type stops being a dropdown', async () => {
    const user = userEvent.setup()
    const onSave = renderDialog({ ...TEXT_PARAM, type: 'enum', enumOptions: 'A\nB' })

    await chooseType(user, 'Date')
    await save(user)

    const saved = onSave.mock.calls[0][0]
    expect(saved.type).toBe('date')
    expect(saved.enumOptions).toBeUndefined()
  })
})
