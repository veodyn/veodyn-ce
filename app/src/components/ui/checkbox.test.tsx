import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Checkbox } from './checkbox'

// This primitive replaced every raw <input type="checkbox"> in the app, which
// means it inherited a pile of behaviour those inputs got from the platform for
// free. These cases pin the parts callers rely on: the accessible role, the
// label association through htmlFor/id, keyboard operation, and disabled.

describe('Checkbox', () => {
  it('exposes a checkbox role with its checked state', () => {
    render(<Checkbox checked aria-label="Allow password login" />)

    expect(screen.getByRole('checkbox', { name: 'Allow password login' })).toBeChecked()
  })

  it('reports the new state to onCheckedChange rather than an event', () => {
    // The raw inputs read e.target.checked; every call site was rewritten to
    // take the boolean directly, so this is the contract they depend on.
    const onCheckedChange = vi.fn()
    render(<Checkbox checked={false} onCheckedChange={onCheckedChange} aria-label="Donut" />)

    screen.getByRole('checkbox').click()

    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything())
  })

  it('toggles when its associated label is clicked', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(
      <>
        <Checkbox id="saml" checked={false} onCheckedChange={onCheckedChange} />
        <label htmlFor="saml">Allow SAML login</label>
      </>
    )

    await user.click(screen.getByText('Allow SAML login'))

    expect(onCheckedChange).toHaveBeenCalledTimes(1)
  })

  it('toggles on Space, like the input it replaced', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(<Checkbox checked={false} onCheckedChange={onCheckedChange} aria-label="Log scale" />)

    await user.tab()
    expect(screen.getByRole('checkbox')).toHaveFocus()
    await user.keyboard(' ')

    expect(onCheckedChange).toHaveBeenCalledTimes(1)
  })

  it('does not fire when disabled', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(
      <Checkbox checked={false} disabled onCheckedChange={onCheckedChange} aria-label="Pin" />
    )

    await user.click(screen.getByRole('checkbox'))

    expect(onCheckedChange).not.toHaveBeenCalled()
  })
})
