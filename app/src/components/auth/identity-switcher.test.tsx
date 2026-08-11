// A demo instance has one browser and four-eyes needs two people, so the
// publishing half of Reports could not be walked at all: submit for review, and
// then nobody in the building may approve.
import { beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { buildPolicy } from '@/lib/policy'
import { useAuthStore } from '@/stores/auth-store'
import { IdentitySwitcher } from '@/components/auth/identity-switcher'
import { safeNextPath } from '@/components/auth/login-screen'

describe('IdentitySwitcher', () => {
  beforeEach(async () => {
    window.localStorage.clear()
    useAuthStore.setState({ currentUser: null, isAuthenticated: false, isLoading: true })
    await useAuthStore.getState().loadSession()
    useAuthStore.setState({ useRealApi: false })
  })

  it('becomes the chosen identity', async () => {
    const user = userEvent.setup()
    renderWithProviders(<IdentitySwitcher />)

    await user.click(screen.getByRole('combobox', { name: /Acting as/i }))
    await user.click(await screen.findByRole('option', { name: 'Maya Reviewer' }))

    await waitFor(() => expect(useAuthStore.getState().currentUser?.name).toBe('Maya Reviewer'))
    // Maya is the second identity that may approve, which is the whole point.
    // Through the policy, because that is where the rule lives: an admin
    // publishes by being an admin, and Redash's admin group will never carry
    // publish_report.
    expect(buildPolicy(useAuthStore.getState().currentUser ?? null).canPublishReport()).toBe(true)
  })

  it('does not offer an invitation nobody accepted', async () => {
    const user = userEvent.setup()
    renderWithProviders(<IdentitySwitcher />)

    await user.click(screen.getByRole('combobox', { name: /Acting as/i }))

    expect(await screen.findByRole('option', { name: 'Jane Analyst' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Pending User' })).not.toBeInTheDocument()
  })

  it('stays out of a configured deployment, where identities come from Redash', () => {
    useAuthStore.setState({ useRealApi: true })
    const { container } = renderWithProviders(<IdentitySwitcher />)

    expect(container).toBeEmptyDOMElement()
  })
})

describe('the sign-in return path', () => {
  it('follows a same-origin path', () => {
    expect(safeNextPath('/reports/weekly')).toBe('/reports/weekly')
    expect(safeNextPath('/queries?page=3')).toBe('/queries?page=3')
    expect(safeNextPath('/kpis#chart')).toBe('/kpis#chart')
  })

  it.each([
    // Protocol-relative: a startsWith('/') check alone sends the browser off-site.
    '//evil.example/phish',
    // The URL parser normalises a backslash to a slash, so this is the same
    // attack wearing a different character, and a character-level check misses it.
    '/\\evil.example',
    '/\\\\evil.example',
    '\\/evil.example',
    'https://evil.example',
    'http://evil.example',
    // A scheme that runs script rather than navigating.
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
  ])('refuses %s rather than becoming an open redirect', (candidate) => {
    expect(safeNextPath(candidate)).toBe('/')
  })

  it('falls back to the root on nothing at all', () => {
    expect(safeNextPath(null)).toBe('/')
    expect(safeNextPath(undefined)).toBe('/')
    expect(safeNextPath('')).toBe('/')
  })
})
