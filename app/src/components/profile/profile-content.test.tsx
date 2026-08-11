// The community half of the profile page: the queries and dashboards this
// person owns, and the stack they sit in.
//
// The KPI section is the KPI feature's contribution to the profile.section
// slot and is covered in components/kpi/profile-section.test.tsx, which also
// asserts the composed path through the real registry (heading, rows and all).
// This file names no KPI now, which is what the seam bought: it was on the
// old CE-build ratchet only because it reached the KPI fixtures.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders, resetStores } from '@/test/utils'
import { ProfileContent } from './profile-content'

// One section's read, refused. Each section owns its own query and its own
// states, and this is what proves the "one backend that is down does not blank
// the sections that are up" claim OwnedSection is written around.
vi.mock('@/hooks/use-queries', () => ({
  useMyQueries: () => ({ data: undefined, isLoading: false, isError: true }),
}))

afterEach(() => resetStores())

describe('ProfileContent', () => {
  it('renders the two sections it owns', async () => {
    renderWithProviders(<ProfileContent userId={2} />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /your queries/i })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: /your dashboards/i })).toBeInTheDocument()
    })
  })

  it('reports a refused read in the section that made it, and leaves the others standing', async () => {
    renderWithProviders(<ProfileContent userId={2} />)

    expect(await screen.findByText('Unable to load your queries.')).toBeInTheDocument()
    // The section beside it is untouched: still headed, and not carrying the
    // failure of a read it did not make.
    expect(screen.getByRole('heading', { name: /your dashboards/i })).toBeInTheDocument()
    expect(screen.queryByText('Unable to load your dashboards.')).not.toBeInTheDocument()
  })
})
