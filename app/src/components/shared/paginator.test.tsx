import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Paginator } from './paginator'

describe('Paginator', () => {
  // Button supplies focus-visible styling; a raw <button> here had none, so a
  // keyboard user could not see which control they were on.
  it('gives its page controls a visible focus ring', () => {
    render(<Paginator page={2} totalPages={5} onChange={() => {}} />)
    for (const name of [/previous/i, /next/i]) {
      const button = screen.getByRole('button', { name })
      expect(button.className).toMatch(/focus-visible:/)
    }
  })
})
