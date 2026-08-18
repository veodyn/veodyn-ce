// The community dashboard toolbar: what it shows on a build with no feature
// filling dashboard.viewActions. The contributed action itself is covered in
// dashboard-promote.test.tsx, which goes with the reports feature.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'
import { useMockDataStore } from '@/stores/mock-data-store'
import { required } from '@/lib/required'
import type { FeatureDescriptor } from '@/features/types'
import { DashboardViewActions } from './dashboard-view-actions'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}))

/**
 * A build that has the wall package, stated rather than looked up, so the two
 * cases below are about the gate rather than about whatever the tree happens to
 * have installed. Present is community markup pointing at /present, which the
 * wall package owns, so it is GATED on the package rather than contributed.
 *
 * The descriptor contributes no slots, so `dashboard.viewActions` stays
 * unfilled: a Present button with no contributed action is the shape pinned.
 */
const WALL_INSTALLED: Record<string, FeatureDescriptor> = {
  wall: { id: 'wall', nav: [], routes: [] },
}

// Wrapping the real hasFeature rather than faking its answer, so the real
// lookup runs against each registry.
let mockRegistry: Record<string, FeatureDescriptor> = WALL_INSTALLED
vi.mock('@/features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features')>()
  return {
    ...actual,
    hasFeature: (id: string) => actual.hasFeature(id, mockRegistry),
  }
})

afterEach(() => {
  mockRegistry = WALL_INSTALLED
})

function renderActions() {
  const dashboard = required(
    useMockDataStore.getState().dashboards[0],
    'a dashboard in the fixtures'
  )
  return renderWithProviders(
    <DashboardViewActions dashboard={dashboard} onEdit={vi.fn()} onShare={vi.fn()} />
  )
}

describe('DashboardViewActions', () => {
  it('renders its own actions without waiting on a contributed one', () => {
    renderActions()

    // Read synchronously: a slot contribution cannot be on screen before its
    // loader resolves, so this first paint is what a build with no contributor
    // renders. role=button, not link: Present is a ui/button rendered as an
    // anchor, and the primitive stamps its own role on that element.
    expect(screen.getByRole('button', { name: /present/i })).toHaveAttribute(
      'href',
      '/present/1'
    )
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /share dashboard/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /promote to report/i })).not.toBeInTheDocument()
  })

  // A build with no wall package has no /present to send anyone to, so the
  // button is absent rather than dead, and gating it takes nothing else.
  it('drops Present, and only Present, on a build with no wall package', () => {
    mockRegistry = {}

    renderActions()

    expect(screen.queryByRole('button', { name: /present/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /share dashboard/i })).toBeInTheDocument()
  })
})
