import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { Separator } from '@/components/ui/separator'

describe('Separator', () => {
  it('renders the separator slot', () => {
    const { container } = render(<Separator />)
    expect(container.firstElementChild).toHaveAttribute('data-slot', 'separator')
  })

  it('sets the vertical orientation attribute', () => {
    const { container } = render(<Separator orientation="vertical" />)
    expect(container.firstElementChild).toHaveAttribute(
      'aria-orientation',
      'vertical'
    )
  })
})
