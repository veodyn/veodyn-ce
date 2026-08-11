import { afterEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { useAuthStore } from '@/stores/auth-store'
import SettingsPage from './page'

afterEach(() => resetStores())

describe('SettingsPage', () => {
  it('wires the General panel as a tabpanel and switches on tab click', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SettingsPage />)

    expect(screen.getByRole('tabpanel')).toBeInTheDocument()
    expect(screen.getByText('Organization')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Authentication' }))

    expect(screen.getByRole('heading', { name: 'Authentication' })).toBeInTheDocument()
    expect(screen.queryByText('Organization')).not.toBeInTheDocument()
  })

  // General used to be a disabled text box holding the literal string "My
  // Organization" over a disabled Save button: three controls saying one fact,
  // and not the true one.
  it('reports the organization the session belongs to, and offers nothing to edit', () => {
    useAuthStore.setState({ orgName: 'Metro Transit Analytics', orgSlug: 'metro' })
    renderWithProviders(<SettingsPage />)

    expect(screen.getByText('Metro Transit Analytics')).toBeInTheDocument()
    expect(screen.getByText('metro')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('says so rather than inventing a name when the session reports none', () => {
    useAuthStore.setState({ orgName: null, orgSlug: null })
    renderWithProviders(<SettingsPage />)

    expect(screen.getByText(/No backend connected|Not reported by this instance/)).toBeInTheDocument()
    expect(screen.queryByText('My Organization')).not.toBeInTheDocument()
  })
})
