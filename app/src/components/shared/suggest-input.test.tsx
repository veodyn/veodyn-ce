import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { SuggestInput } from './suggest-input'

const ZONES = [{ value: 'America/Los_Angeles' }, { value: 'Europe/Berlin' }, { value: 'UTC' }]

function Harness({ suggestions = ZONES }: { suggestions?: { value: string; label?: string }[] }) {
  const [value, setValue] = useState('')
  return (
    <SuggestInput id="zone" value={value} onChange={setValue} suggestions={suggestions} />
  )
}

describe('SuggestInput', () => {
  it('filters the vocabulary as it is typed and fills the field from a pick', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness />)

    await user.click(screen.getByRole('combobox'))
    await user.keyboard('berl')

    expect(screen.queryByText('America/Los_Angeles')).not.toBeInTheDocument()
    await user.click(await screen.findByText('Europe/Berlin'))

    expect(screen.getByRole('combobox')).toHaveValue('Europe/Berlin')
  })

  it('picks with the keyboard, without the field ever losing focus', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness />)

    await user.click(screen.getByRole('combobox'))
    await user.keyboard('europe{ArrowDown}{Enter}')

    expect(screen.getByRole('combobox')).toHaveValue('Europe/Berlin')
    expect(screen.getByRole('combobox')).toHaveFocus()
  })

  it('keeps a typed value the list does not carry', async () => {
    // The GBFS language field is a pattern, not an enum, so a subtag this list
    // has no row for must still be enterable.
    const user = userEvent.setup()
    renderWithProviders(<Harness suggestions={[{ value: 'en', label: 'English' }]} />)

    await user.click(screen.getByRole('combobox'))
    await user.keyboard('pt-BR')

    expect(screen.getByRole('combobox')).toHaveValue('pt-BR')
  })

  it('offers nothing, and stays a plain field, when the vocabulary is empty', async () => {
    // What a capabilities read that failed or has not landed yet leaves behind.
    const user = userEvent.setup()
    renderWithProviders(<Harness suggestions={[]} />)

    await user.click(screen.getByRole('combobox'))
    await user.keyboard('UTC')

    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('combobox')).toHaveValue('UTC')
  })
})
