// The gap this closes: typing SQL and then editing the address bar raised the
// browser's own "Leave site?" prompt, while clicking Dashboards in the sidebar
// discarded the draft immediately and silently. Same unsaved work, opposite
// outcome, decided by which navigation mechanism was used.
//
// What is pinned is the OUTCOME (was the navigation stopped, did the router
// eventually run), not that a listener was attached, so a guard wired to the
// wrong phase or the wrong link fails here.
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UnsavedChangesGuard } from './unsaved-changes-guard'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

/**
 * A link and the guard, with a click handler standing in for Next's own.
 *
 * The handler is what proves the interception happened at the right time: Next
 * attaches its navigation to the anchor through React, so a guard that stops
 * the event too late would let this fire.
 */
function harness(isDirty: boolean, onNavigate = vi.fn(), href = '/dashboards') {
  render(
    <div>
      <a href={href} onClick={() => onNavigate()}>
        Dashboards
      </a>
      <UnsavedChangesGuard isDirty={isDirty} />
    </div>
  )
  return { onNavigate }
}

describe('UnsavedChangesGuard', () => {
  it('stops a sidebar-style link and asks first', async () => {
    const user = userEvent.setup()
    push.mockClear()
    const { onNavigate } = harness(true)

    await user.click(screen.getByRole('link', { name: 'Dashboards' }))

    expect(await screen.findByText('Leave without saving?')).toBeVisible()
    expect(onNavigate).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('goes where the link pointed once the person says to', async () => {
    const user = userEvent.setup()
    push.mockClear()
    harness(true)

    await user.click(screen.getByRole('link', { name: 'Dashboards' }))
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }))

    expect(push).toHaveBeenCalledWith('/dashboards')
  })

  it('stays put when the person keeps editing', async () => {
    const user = userEvent.setup()
    push.mockClear()
    harness(true)

    await user.click(screen.getByRole('link', { name: 'Dashboards' }))
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }))

    expect(push).not.toHaveBeenCalled()
    expect(screen.queryByText('Leave without saving?')).toBeNull()
  })

  it('does not interrupt anything while there is nothing to lose', async () => {
    const user = userEvent.setup()
    push.mockClear()
    const { onNavigate } = harness(false)

    await user.click(screen.getByRole('link', { name: 'Dashboards' }))

    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Leave without saving?')).toBeNull()
  })

  it('lets a link back to the current page through', async () => {
    const user = userEvent.setup()
    push.mockClear()
    // jsdom serves the page at "/", so this link goes nowhere and abandons
    // nothing. Guarding it would be a dialog in front of a no-op.
    const { onNavigate } = harness(true, vi.fn(), '/')

    await user.click(screen.getByRole('link', { name: 'Dashboards' }))

    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Leave without saving?')).toBeNull()
  })

  it('lets an external link through', async () => {
    const user = userEvent.setup()
    push.mockClear()
    const { onNavigate } = harness(true, vi.fn(), 'https://example.com/docs')

    await user.click(screen.getByRole('link', { name: 'Dashboards' }))

    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Leave without saving?')).toBeNull()
  })

  it('lets a new-tab click through, since this page is not going anywhere', async () => {
    const user = userEvent.setup()
    push.mockClear()
    const { onNavigate } = harness(true)

    await user.keyboard('{Meta>}')
    await user.click(screen.getByRole('link', { name: 'Dashboards' }))
    await user.keyboard('{/Meta}')

    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Leave without saving?')).toBeNull()
  })
})
