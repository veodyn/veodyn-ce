import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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
