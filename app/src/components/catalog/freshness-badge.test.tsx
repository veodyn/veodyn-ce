import { afterEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders, resetStores } from '@/test/utils'
import { FreshnessBadge } from './freshness-badge'

afterEach(() => resetStores())

describe('FreshnessBadge', () => {
  it('shows a fresh badge with text and the fresh token, not color alone', () => {
    renderWithProviders(
      <FreshnessBadge freshness={{ lastUpdatedAt: '2026-07-21T06:00:00Z', status: 'fresh' }} />
    )
    const badge = screen.getByText(/fresh/i)
    expect(badge).toBeInTheDocument()
    expect(badge.closest('[class*="text-status-fresh"]')).toBeTruthy()
  })

  it('gives the fresh badge a tinted background, not the default variant background', () => {
    renderWithProviders(
      <FreshnessBadge freshness={{ lastUpdatedAt: '2026-07-21T06:00:00Z', status: 'fresh' }} />
    )
    const badge = screen.getByText(/fresh/i).closest('[class*="bg-status-fresh"]')
    expect(badge).toBeTruthy()
    expect(badge?.className).not.toMatch(/\bbg-primary\b/)
  })

  it('shows a stale badge with text and the stale token, not color alone', () => {
    renderWithProviders(
      <FreshnessBadge freshness={{ lastUpdatedAt: '2020-01-01T00:00:00Z', status: 'stale' }} />
    )
    const badge = screen.getByText(/stale/i)
    expect(badge).toBeInTheDocument()
    expect(badge.closest('[class*="text-status-stale"]')).toBeTruthy()
  })

  it('gives the stale badge a tinted background, not the default variant background', () => {
    renderWithProviders(
      <FreshnessBadge freshness={{ lastUpdatedAt: '2020-01-01T00:00:00Z', status: 'stale' }} />
    )
    const badge = screen.getByText(/stale/i).closest('[class*="bg-status-stale"]')
    expect(badge).toBeTruthy()
    expect(badge?.className).not.toMatch(/\bbg-primary\b/)
  })

  it('renders a TimeAgo for lastUpdatedAt', () => {
    renderWithProviders(
      <FreshnessBadge freshness={{ lastUpdatedAt: '2020-01-01T00:00:00Z', status: 'stale' }} />
    )
    const relativeTime = screen.getByText(/ago/i)
    expect(relativeTime).toBeInTheDocument()
    expect(relativeTime).toHaveClass('tabular-nums')
  })

  it('renders the fresh status word in text-foreground (not the status color) for WCAG AA contrast, while the icon and border keep the status color', () => {
    renderWithProviders(
      <FreshnessBadge freshness={{ lastUpdatedAt: '2026-07-21T06:00:00Z', status: 'fresh' }} />
    )
    const word = screen.getByText('Fresh')
    expect(word).toHaveClass('text-foreground')
    expect(word.className).not.toMatch(/text-status-fresh/)

    const icon = document.querySelector('.lucide-circle-check')
    expect(icon?.closest('[class*="text-status-fresh"]')).toBeTruthy()
    expect(icon?.closest('[class*="border-status-fresh"]')).toBeTruthy()
  })

  it('renders the stale status word in text-foreground (not the status color) for WCAG AA contrast, while the icon and border keep the status color', () => {
    renderWithProviders(
      <FreshnessBadge freshness={{ lastUpdatedAt: '2020-01-01T00:00:00Z', status: 'stale' }} />
    )
    const word = screen.getByText('Stale')
    expect(word).toHaveClass('text-foreground')
    expect(word.className).not.toMatch(/text-status-stale/)

    const icon = document.querySelector('.lucide-triangle-alert')
    expect(icon?.closest('[class*="text-status-stale"]')).toBeTruthy()
    expect(icon?.closest('[class*="border-status-stale"]')).toBeTruthy()
  })
})
