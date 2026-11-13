import { expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CodeBlock } from '@/components/shared/code-block'

// This used to pin the hover reveal: `group-hover:opacity-100` plus a
// `focus-visible:opacity-100` override so a keyboard user, who never triggers
// group-hover, could still reach it. The concern was right and the remedy was
// half of one. Both callers are Connect pages whose whole job is handing over
// strings to copy, and a pointer user cannot reach a control they cannot see
// either: the pages read as offering no way to copy anything.
//
// So the button is simply visible now, and the assertion moves with it. Pinning
// the classes rather than the property would have made this a test that has to
// be edited whenever the styling is, which is what it just was.
it('shows the copy button without waiting to be hovered or focused', () => {
  render(<CodeBlock code="select 1" />)
  const button = screen.getByRole('button', { name: /copy/i })
  expect(button.className).not.toMatch(/opacity-0/)
  expect(button).toBeVisible()
})

it('announces a successful copy in a status region', async () => {
  const user = userEvent.setup()
  render(<CodeBlock code="select 1" />)

  await user.click(screen.getByRole('button', { name: 'Copy code' }))

  expect(await screen.findByRole('status')).toHaveTextContent('Copied')
})

it('shows and announces a failure when the clipboard rejects the write', async () => {
  const user = userEvent.setup()
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
  render(<CodeBlock code="select 1" />)

  await user.click(screen.getByRole('button', { name: 'Copy code' }))

  expect(await screen.findByRole('status')).toHaveTextContent('Copy failed')
  expect(screen.getByRole('button', { name: 'Copy failed' })).toBeInTheDocument()
})
