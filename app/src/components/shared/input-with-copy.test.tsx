import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { InputWithCopy } from '@/components/shared/input-with-copy'

describe('InputWithCopy', () => {
  it('associates its label with the input', () => {
    render(<InputWithCopy label="Public URL" value="https://example.test" />)
    expect(screen.getByLabelText('Public URL')).toHaveValue('https://example.test')
  })

  // Button supplies focus-visible styling; a raw <button> here had none, so a
  // keyboard user could not see which control they were on.
  it('gives the copy button a visible focus ring', () => {
    render(<InputWithCopy label="Public URL" value="https://example.test" />)
    const button = screen.getByRole('button', { name: 'Copy to clipboard' })
    expect(button.className).toMatch(/focus-visible:/)
  })
})

describe('InputWithCopy feedback', () => {
  it('announces a successful copy in a status region', async () => {
    const user = userEvent.setup()
    render(<InputWithCopy label="Public URL" value="https://example.test" />)

    await user.click(screen.getByRole('button', { name: 'Copy to clipboard' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Copied')
  })

  it('shows and announces a failure when the clipboard rejects the write', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    render(<InputWithCopy label="Public URL" value="https://example.test" />)

    await user.click(screen.getByRole('button', { name: 'Copy to clipboard' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Copy failed')
    expect(screen.getByRole('button', { name: 'Copy failed' })).toBeInTheDocument()
  })
})
