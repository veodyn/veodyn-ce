// The community dashboard toolbar: what it shows on a build that has no
// feature filling dashboard.viewActions.
//
// The contributed action itself, and the report it writes, are covered in
// dashboard-promote.test.tsx, which goes with the reports feature. What is
// asserted here is the shape the toolbar keeps without it.
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
 * A build that has the wall package, stated rather than looked up.
 *
 * Present is community markup pointing at /present, which the wall package
 * owns, so it is GATED on that package rather than contributed by it, and
 * `hasFeature` asks only whether the key is there. Naming the registry is what
 * lets the two cases below be about the gate: driven by whatever the tree had
 * installed, the first one re-asserted the enterprise answer where the package
 * was present and said nothing where it was not.
 *
 * The descriptor contributes no slots, so `dashboard.viewActions` is still
 * unfilled here. That is the other half of the first case and it has to stay
 * that way: a toolbar with a Present button and no contributed action is
 * exactly the shape being pinned.
 */
const WALL_INSTALLED: Record<string, FeatureDescriptor> = {
  wall: { id: 'wall', nav: [], routes: [] },
}

// Wrapping the real hasFeature rather than faking its answer, so the real
// lookup runs against each registry, the same way
// authenticated-layout.registry.test.tsx does it for featureRouteFor.
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

    // Read synchronously, on purpose. A slot contribution cannot be on screen
    // before its loader resolves, so this first paint IS what a build with no
    // contributor renders: the toolbar is whole, and the contributed action is
    // the only thing missing from it. Present is here because the registry
    // above says the wall package is, which is the gate and not a slot.
    // role=button, not link: Present is a ui/button rendered as an anchor, and
    // the primitive stamps its own role on the element it renders into.
    expect(screen.getByRole('button', { name: /present/i })).toHaveAttribute(
      'href',
      '/present/1'
    )
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /share dashboard/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /promote to report/i })).not.toBeInTheDocument()
  })

  // The other half of the same toolbar: a build with no wall package has no
  // /present to send anyone to, so the button is absent rather than dead. The
  // rest of the row is untouched, which is the property worth pinning: gating
  // one action must not take a community one with it.
  it('drops Present, and only Present, on a build with no wall package', () => {
    mockRegistry = {}

    renderActions()

    expect(screen.queryByRole('button', { name: /present/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /share dashboard/i })).toBeInTheDocument()
  })
})
