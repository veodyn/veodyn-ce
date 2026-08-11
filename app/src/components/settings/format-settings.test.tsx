import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { Toaster } from '@/components/ui/sonner'
import { renderWithProviders, resetStores } from '@/test/utils'
import { FormatSettings } from './format-settings'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

const settings = {
  date_format: 'YYYY-MM-DD',
  time_format: 'HH:mm:ss',
  integer_format: '0,0',
  float_format: '0,0.000',
}

beforeEach(() => {
  server.use(
    http.get('/api/node/settings/organization', () => HttpResponse.json({ settings }))
  )
})

afterEach(() => {
  resetStores()
})

describe('FormatSettings', () => {
  it('loads and renders the current organization formats', async () => {
    renderWithProviders(<FormatSettings />)

    expect(screen.getByText('Display Formats')).toBeInTheDocument()
    // Editorial Light renders the date/time format fields as base-ui Select
    // comboboxes rather than native <select>s, so the loaded values are
    // verified through each trigger's resolved label.
    const [dateTrigger, timeTrigger] = screen.getAllByRole('combobox')
    expect(await within(dateTrigger).findByText('YYYY-MM-DD')).toBeInTheDocument()
    expect(within(timeTrigger).getByText('24h (HH:mm:ss)')).toBeInTheDocument()
  })

  it('offers only the formats this app actually applies', async () => {
    // Integer and Float were moment/numeral patterns that Redash applies inside
    // its own result grid, which this app does not render through. Offering
    // them was the same broken promise the finding was about.
    renderWithProviders(<FormatSettings />)

    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(2))
    expect(screen.queryByText('Integer Format')).not.toBeInTheDocument()
    expect(screen.queryByText('Float Format')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('0,0')).not.toBeInTheDocument()
  })

  it('shows how a date currently reads, so the setting is not taken on faith', async () => {
    renderWithProviders(<FormatSettings />)

    // Wait for the saved settings to land: before they do the preview honestly
    // shows the defaults.
    await within(screen.getAllByRole('combobox')[0]).findByText('YYYY-MM-DD')

    // The loaded settings are YYYY-MM-DD and HH:mm:ss.
    await waitFor(() =>
      expect(screen.getByTestId('format-preview')).toHaveTextContent(
        /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/
      )
    )
  })

  it('posts the edited formats to the organization settings endpoint', async () => {
    const user = userEvent.setup()
    let requestBody: unknown
    server.use(
      http.post('/api/node/settings/organization', async ({ request }) => {
        requestBody = await request.json()
        return HttpResponse.json({ settings: requestBody })
      })
    )
    renderWithProviders(<FormatSettings />)

    const dateTrigger = screen.getAllByRole('combobox')[0]
    await within(dateTrigger).findByText('YYYY-MM-DD')
    await user.click(dateTrigger)
    await user.click(await screen.findByRole('option', { name: 'MM/DD/YYYY' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(requestBody).toEqual({
        date_format: 'MM/DD/YYYY',
        time_format: 'HH:mm:ss',
      })
    )
  })

  it('confirms the save', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/node/settings/organization', async ({ request }) =>
        HttpResponse.json({ settings: await request.json() })
      )
    )
    renderWithProviders(
      <>
        <FormatSettings />
        <Toaster />
      </>
    )

    await within(screen.getAllByRole('combobox')[0]).findByText('YYYY-MM-DD')
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
