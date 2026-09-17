import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Label } from '@/components/ui/label'
import { RequiredHeading } from '@/components/shared/required-heading'

describe('Label', () => {
  it('renders no marker by default', () => {
    render(<Label htmlFor="name">Name</Label>)
    expect(screen.getByText('Name').querySelector('[data-slot="required-marker"]')).toBeNull()
  })

  it('renders a hidden star after the text when required', () => {
    render(<Label htmlFor="name" required>Name</Label>)
    const marker = screen.getByText('Name').querySelector('[data-slot="required-marker"]')
    expect(marker).not.toBeNull()
    expect(marker).toHaveAttribute('aria-hidden', 'true')
    expect(marker).toHaveTextContent('*')
  })

  it('keeps the accessible name free of the star', () => {
    render(
      <>
        <Label htmlFor="name" required>
          Name
        </Label>
        <input id="name" required aria-required="true" />
      </>
    )
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeRequired()
  })
})

describe('RequiredHeading', () => {
  it('marks a heading-labelled group the same way', () => {
    render(
      <RequiredHeading id="channels" required>
        Channels
      </RequiredHeading>
    )
    const heading = screen.getByRole('heading', { name: 'Channels' })
    expect(heading.parentElement?.querySelector('[data-slot="required-marker"]')).not.toBeNull()
  })
})
