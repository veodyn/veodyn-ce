import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { QueryResultColumn } from '@/lib/mock-data'
import { renderWithProviders, resetStores } from '@/test/utils'
import { CohortEditor } from './cohort-editor'

afterEach(() => resetStores())

const columns: QueryResultColumn[] = [
  { name: 'signup_week', friendly_name: 'Signup Week', type: 'date' },
  { name: 'week_number', friendly_name: 'Week Number', type: 'integer' },
  { name: 'cohort_size', friendly_name: 'Cohort Size', type: 'integer' },
  { name: 'active_users', friendly_name: 'Active Users', type: 'integer' },
]

// Every field is seeded with a DIFFERENT column, and `mode` is an unrelated key
// nothing in this editor touches. So a control reading the wrong option key
// shows the wrong column name, and one that writes without spreading the
// existing options drops `mode` on the floor. Both fail rather than passing on
// a value that happened to match.
const seededOptions = {
  dateColumn: 'signup_week',
  stageColumn: 'week_number',
  totalColumn: 'cohort_size',
  valueColumn: 'active_users',
  mode: 'simple',
}

// These editors render the shadcn/base-ui Select, not a native <select>: the
// trigger is a button showing the option's label, so state is read as text and
// a change is a click on the trigger followed by a click on the option. Each
// control is reached by its ACCESSIBLE NAME, not by its index in
// getAllByRole('combobox'), so the test also asserts the label is connected to
// the trigger rather than sitting beside it naming nothing.
const cohortSelect = () => screen.getByRole('combobox', { name: 'Cohort Column' })
const stageSelect = () => screen.getByRole('combobox', { name: 'Stage Column' })
const totalSelect = () => screen.getByRole('combobox', { name: 'Cohort Total Column' })
const valueSelect = () => screen.getByRole('combobox', { name: 'Value Column' })

describe('CohortEditor', () => {
  it('reflects the seeded column for every field, each off its own key', () => {
    renderWithProviders(
      <CohortEditor options={seededOptions} columns={columns} onChange={() => {}} />
    )

    expect(screen.getAllByRole('combobox')).toHaveLength(4)
    expect(cohortSelect()).toHaveTextContent('signup_week')
    expect(stageSelect()).toHaveTextContent('week_number')
    expect(totalSelect()).toHaveTextContent('cohort_size')
    expect(valueSelect()).toHaveTextContent('active_users')
  })

  // An editor that wrote its own defaults on mount would rewrite the stored
  // JSON of every saved cohort the first time an author opened it.
  it('does not call onChange on mount', () => {
    const onChange = vi.fn()

    renderWithProviders(
      <CohortEditor options={seededOptions} columns={columns} onChange={onChange} />
    )

    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows nothing outstanding once all four columns are set', () => {
    renderWithProviders(
      <CohortEditor options={seededOptions} columns={columns} onChange={() => {}} />
    )

    expect(screen.queryByText(/still needed/i)).not.toBeInTheDocument()
  })

  // buildCohortModel returns an empty grid unless all four are set, so an
  // author who set two of them sees a blank visualization with no explanation.
  it('names the columns still missing, and only those', () => {
    renderWithProviders(
      <CohortEditor
        options={{ dateColumn: 'signup_week', totalColumn: 'cohort_size' }}
        columns={columns}
        onChange={() => {}}
      />
    )

    const hint = screen.getByText(/still needed/i)
    expect(hint).toHaveTextContent('Stage Column')
    expect(hint).toHaveTextContent('Value Column')
    expect(hint).not.toHaveTextContent('Cohort Total Column')
  })
})

// One test per control, each asserting the WHOLE payload. Asserting only the
// changed key would pass an implementation that writes to a sibling key (the
// four are interchangeable strings over the same column list) or that drops
// the rest of the options.
describe('CohortEditor writes each column to its own option key', () => {
  it('writes dateColumn when the Cohort Column changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(
      <CohortEditor options={seededOptions} columns={columns} onChange={onChange} />
    )

    await user.click(cohortSelect())
    await user.click(await screen.findByRole('option', { name: 'week_number' }))

    expect(onChange).toHaveBeenCalledWith({
      dateColumn: 'week_number',
      stageColumn: 'week_number',
      totalColumn: 'cohort_size',
      valueColumn: 'active_users',
      mode: 'simple',
    })
  })

  it('writes stageColumn when the Stage Column changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(
      <CohortEditor options={seededOptions} columns={columns} onChange={onChange} />
    )

    await user.click(stageSelect())
    await user.click(await screen.findByRole('option', { name: 'cohort_size' }))

    expect(onChange).toHaveBeenCalledWith({
      dateColumn: 'signup_week',
      stageColumn: 'cohort_size',
      totalColumn: 'cohort_size',
      valueColumn: 'active_users',
      mode: 'simple',
    })
  })

  it('writes totalColumn when the Cohort Total Column changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(
      <CohortEditor options={seededOptions} columns={columns} onChange={onChange} />
    )

    await user.click(totalSelect())
    await user.click(await screen.findByRole('option', { name: 'active_users' }))

    expect(onChange).toHaveBeenCalledWith({
      dateColumn: 'signup_week',
      stageColumn: 'week_number',
      totalColumn: 'active_users',
      valueColumn: 'active_users',
      mode: 'simple',
    })
  })

  it('writes valueColumn when the Value Column changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(
      <CohortEditor options={seededOptions} columns={columns} onChange={onChange} />
    )

    await user.click(valueSelect())
    await user.click(await screen.findByRole('option', { name: 'signup_week' }))

    expect(onChange).toHaveBeenCalledWith({
      dateColumn: 'signup_week',
      stageColumn: 'week_number',
      totalColumn: 'cohort_size',
      valueColumn: 'signup_week',
      mode: 'simple',
    })
  })

  // The reset item the map and counter editors had to grow: without it a
  // column picked by mistake can never be put back to unset.
  it('clears the column back to unset when the empty option is chosen', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(
      <CohortEditor options={seededOptions} columns={columns} onChange={onChange} />
    )

    await user.click(stageSelect())
    await user.click(await screen.findByRole('option', { name: 'Select column...' }))

    expect(onChange).toHaveBeenCalledWith({
      dateColumn: 'signup_week',
      stageColumn: '',
      totalColumn: 'cohort_size',
      valueColumn: 'active_users',
      mode: 'simple',
    })
  })
})
