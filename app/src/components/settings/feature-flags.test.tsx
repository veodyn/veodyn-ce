import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores } from '@/test/utils'
import { Toaster } from '@/components/ui/sonner'
import { FeatureFlags } from './feature-flags'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

afterEach(() => resetStores())

// Every listed flag must name an organization setting the backend accepts.
// "Allow Scripts in User Input" is deliberately absent: it has no such setting,
// so that toggle could only ever have been decorative.
const FLAG_LABELS = [
  'Show Permissions Control',
  'Multi-Byte Search',
  'Usage Data Sharing',
  'Disable Public URLs',
]

function stubOrgSettings(onPost?: (body: Record<string, unknown>) => void) {
  server.use(
    http.get('/api/node/settings/organization', () =>
      HttpResponse.json({ settings: { feature_show_permissions_control: true } })
    ),
    http.post('/api/node/settings/organization', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      onPost?.(body)
      return HttpResponse.json({ settings: body })
    })
  )
}

describe('FeatureFlags', () => {
  // Switches, not buttons wearing a thumb: an on/off setting reads as "switch,
  // on" to a screen reader, where aria-pressed on a button reads as "pressed".
  it('exposes each flag label as the accessible name of a switch', () => {
    renderWithProviders(<FeatureFlags />)

    for (const label of FLAG_LABELS) {
      expect(screen.getByRole('switch', { name: label })).toBeInTheDocument()
    }
    expect(
      screen.queryByRole('switch', { name: 'Allow Scripts in User Input' })
    ).not.toBeInTheDocument()
  })

  it('reports each flag state as checked or not', async () => {
    stubOrgSettings()
    renderWithProviders(<FeatureFlags />)

    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Show Permissions Control' })).toBeChecked()
    )
    expect(screen.getByRole('switch', { name: 'Multi-Byte Search' })).not.toBeChecked()
  })

  it('is operable from the keyboard', async () => {
    const user = userEvent.setup()
    stubOrgSettings()
    renderWithProviders(<FeatureFlags />)

    const flag = screen.getByRole('switch', { name: 'Multi-Byte Search' })
    await waitFor(() => expect(flag).not.toBeDisabled())
    flag.focus()
    await user.keyboard(' ')

    expect(flag).toBeChecked()
  })

  it('offers nothing to save until a flag would actually change', async () => {
    const user = userEvent.setup()
    stubOrgSettings()
    renderWithProviders(<FeatureFlags />)

    const flag = screen.getByRole('switch', { name: 'Multi-Byte Search' })
    await waitFor(() => expect(flag).not.toBeDisabled())
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await user.click(flag)
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()

    // Back where it started, so there is nothing to write.
    await user.click(flag)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('persists the toggles and confirms the save', async () => {
    const user = userEvent.setup()
    let posted: Record<string, unknown> | null = null
    stubOrgSettings((body) => {
      posted = body
    })
    renderWithProviders(
      <>
        <FeatureFlags />
        <Toaster />
      </>
    )

    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Multi-Byte Search' })).not.toBeDisabled()
    )
    await user.click(screen.getByRole('switch', { name: 'Multi-Byte Search' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(posted).not.toBeNull())
    expect(posted).toMatchObject({ multi_byte_search_enabled: true })
    // Toaster is not mounted by renderWithProviders, so this test mounts it
    // itself alongside the component to assert on what actually reaches the
    // screen, not a spy call. Scoped to sonner's own data-type="success"
    // attribute rather than a bare text query: the text reaching the DOM
    // proves the message was shown, not that it arrived as a confirmation
    // rather than a refusal.
    await waitFor(() =>
      expect(document.querySelector('[data-sonner-toast][data-type="success"]')).toHaveTextContent(
        /Feature flags saved/i
      )
    )
  })
})
