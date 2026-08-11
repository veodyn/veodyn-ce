// In mock mode Save used to announce "Settings saved (mock)" and change
// nothing anywhere, which is the same non-event the finding described in a
// friendlier voice. There is no backend to persist to, but the app can at least
// honour the choice for the session.
import { afterEach, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { Toaster } from '@/components/ui/sonner'
import { FormatSettings } from './format-settings'

afterEach(() => {
  resetStores()
})

describe('FormatSettings in mock mode', () => {
  it('applies the chosen format to what the app renders', async () => {
    const user = userEvent.setup()
    renderWithProviders(<FormatSettings />)

    const preview = await screen.findByTestId('format-preview')
    expect(preview).toHaveTextContent(/\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}/)

    const dateTrigger = screen.getAllByRole('combobox')[0]
    await user.click(dateTrigger)
    await user.click(await screen.findByRole('option', { name: 'YYYY-MM-DD' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(screen.getByTestId('format-preview')).toHaveTextContent(
        /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/
      )
    )
  })

  it('confirms the save without claiming more than it did', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <>
        <FormatSettings />
        <Toaster />
      </>
    )

    await within(screen.getAllByRole('combobox')[0]).findByText('MM/DD/YY')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // Scoped to sonner's own data-type="success" attribute rather than a bare
    // text query: the text reaching the DOM proves the message was shown, not
    // that it arrived as a confirmation rather than a refusal.
    await waitFor(() =>
      expect(document.querySelector('[data-sonner-toast][data-type="success"]')).toHaveTextContent(
        'Settings saved'
      )
    )
  })
})
