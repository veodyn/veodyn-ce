import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toaster } from '@/components/ui/sonner'
import { useToast } from '@/components/shared/toast-provider'

function Harness() {
  const toast = useToast()
  return (
    <>
      <button onClick={() => toast.error('Could not save')}>fail</button>
      <button onClick={() => toast.error('Could not save again')}>fail again</button>
      <button onClick={() => toast.success('Saved')}>succeed</button>
    </>
  )
}

describe('useToast on sonner', () => {
  // The assertive mirror stays mounted even when empty: a live region that
  // appears at the same moment as its content is often missed by screen
  // readers. sonner's own polite region needs no such mirror (see
  // src/components/ui/sonner.tsx), so there is only one to check here.
  it('keeps the assertive region mounted before anything happens', () => {
    render(<Toaster />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeEmptyDOMElement()
  })

  // A silently failing write is the worst recorded outcome on this branch, so
  // the error path is what this test guards, not the happy path. Scoped to
  // role="alert" rather than a bare text query: sonner's own toast bubble
  // also paints "Could not save" on screen (its own aria-live="polite"
  // region announces every toast regardless of type), so an unscoped query
  // would match twice. role="alert" carries an implicit
  // aria-live="assertive", the interrupting behaviour a refusal needs.
  // Queried with waitFor rather than findByRole: the alert element already
  // exists (empty) before the click, so findByRole would resolve immediately
  // instead of waiting for its content.
  it('surfaces a refusal through an assertive live region', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Harness />
        <Toaster />
      </>
    )

    await user.click(screen.getByRole('button', { name: 'fail' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not save'))
    // The old provider rendered a dismiss button under this name; sonner's
    // closeButton defaults to off, which would have left a toast only
    // swipeable or wait-outable.
    expect(await screen.findByRole('button', { name: 'Dismiss notification' })).toBeInTheDocument()
  })

  // sonner PREPENDS new toasts (index 0 is newest), not appends. A picker
  // that walks from the wrong end finds the OLDEST urgent toast still on
  // screen, so a second refusal arriving while the first is still up would
  // never be announced: the assertive region would keep reading the first
  // message for its whole duration, which is precisely the failure mode this
  // component exists to prevent. A single-toast test cannot catch this
  // (with one element in the list, "first" and "newest" are the same
  // element), so this one fires two distinct refusals in sequence.
  it('announces the newest refusal, not the first, when a second arrives before the first clears', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Harness />
        <Toaster />
      </>
    )

    await user.click(screen.getByRole('button', { name: 'fail' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not save'))

    await user.click(screen.getByRole('button', { name: 'fail again' }))

    // Bounded well under sonner's default 4s toast duration, deliberately:
    // the first toast auto-dismissing on its own timer would eventually leave
    // only the second one in the list, at which point even the buggy
    // (oldest-first) picker finds it too, and this assertion would pass for
    // the wrong reason if it were allowed to wait that long.
    await waitFor(
      () => expect(screen.getByRole('alert')).toHaveTextContent('Could not save again'),
      { timeout: 1000 }
    )
  })

  // The old Zustand store collapsed a repeated identical (type, message) pair
  // into the one toast already on screen instead of stacking a copy per
  // call. useToast now reproduces that through sonner's own id-based replace
  // (see the comment in toast-provider.tsx) rather than bookkeeping of its
  // own, so this fires the same refusal twice and checks the DOM for exactly
  // one toast element, not a spy call on how many times sonner's own API was
  // invoked.
  it('collapses a repeated identical refusal into the one toast already on screen', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <>
        <Harness />
        <Toaster />
      </>
    )

    await user.click(screen.getByRole('button', { name: 'fail' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not save'))

    await user.click(screen.getByRole('button', { name: 'fail' }))

    await waitFor(() =>
      expect(container.querySelectorAll('[data-sonner-toast][data-type="error"]')).toHaveLength(1)
    )
  })

  // A save confirmation is not an emergency. sonner's own container already
  // announces it politely (aria-live="polite", no role — role="status" would
  // be redundant with that, so this app does not add one), and the important
  // half of this test is the negative: a confirmation must never also raise
  // the assertive region reserved for refusals.
  it('surfaces a confirmation through sonner\'s own polite region, not the assertive one', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <>
        <Harness />
        <Toaster />
      </>
    )

    // sonner's <section aria-live="polite"> is unconditional (present from
    // mount, before any toast), so it is grabbed once here rather than
    // located via the message text: sonner's own subscriber and this app's
    // assertive mirror update from two independent subscriptions to the same
    // event, on their own ticks, so a bare findByText('Saved') can resolve
    // against whichever one updates first and race the other. Scoped to this
    // render's own container rather than the whole document: sonner renders
    // inline (no portal), so the polite section is a real descendant of it.
    const politeRegion = container.querySelector('[aria-live="polite"]')
    expect(politeRegion).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'succeed' }))

    await waitFor(() => expect(politeRegion).toHaveTextContent('Saved'))
    expect(screen.getByRole('alert')).toBeEmptyDOMElement()
  })
})
