import { afterEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders, resetStores } from '@/test/utils'
import { ProfileIdentity } from './profile-identity'
import type { RedashUserDetail } from '@/components/users/user-detail-types'

afterEach(() => resetStores())

const USER = {
  id: 7, name: 'Nick Sawinyh', email: 'nick@veodyn.com', profile_image_url: null,
  groups: [1], created_at: '2026-01-02T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
  disabled_at: null, is_disabled: false, active_at: '2026-07-25T00:00:00Z',
  is_invitation_pending: false, is_email_verified: true, auth_type: 'password',
  api_key: 'k',
} satisfies RedashUserDetail

describe('ProfileIdentity', () => {
  it('shows the name as the page heading with initials when there is no image', () => {
    renderWithProviders(<ProfileIdentity user={USER} />)
    expect(screen.getByRole('heading', { name: 'Nick Sawinyh' })).toBeInTheDocument()
    expect(screen.getByText('NS')).toBeInTheDocument()
  })

  it('shows initials for the Gravatar URL Redash synthesises, not the identicon', () => {
    // profile_image_url is never null against a real backend, so this, not the
    // null above, is the case a signed-in person actually sees.
    const { container } = renderWithProviders(
      <ProfileIdentity
        user={{
          ...USER,
          profile_image_url:
            'https://www.gravatar.com/avatar/6f1ed002ab5595859014ebf0951522d9?s=40&d=identicon',
        }}
      />
    )
    expect(screen.getByText('NS')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })

  it('still renders an avatar a user genuinely uploaded', () => {
    const { container } = renderWithProviders(
      <ProfileIdentity user={{ ...USER, profile_image_url: 'https://cdn.example.com/n.png' }} />
    )
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.example.com/n.png')
    expect(screen.queryByText('NS')).not.toBeInTheDocument()
  })

  it('shows no account status badge, because that is an admin judgement', () => {
    renderWithProviders(<ProfileIdentity user={{ ...USER, is_disabled: true }} />)
    expect(screen.queryByText(/^(active|disabled|pending)$/i)).not.toBeInTheDocument()
  })
})
