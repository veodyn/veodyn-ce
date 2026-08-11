import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

describe('Popover', () => {
  it('does not render its content when closed', () => {
    render(
      <Popover>
        <PopoverTrigger>More</PopoverTrigger>
        <PopoverContent>Query details</PopoverContent>
      </Popover>
    )
    expect(screen.queryByText('Query details')).not.toBeInTheDocument()
  })

  it('renders its content when open', () => {
    render(
      <Popover defaultOpen>
        <PopoverTrigger>More</PopoverTrigger>
        <PopoverContent>Query details</PopoverContent>
      </Popover>
    )
    expect(screen.getByText('Query details')).toBeInTheDocument()
  })

  it('opens when the trigger is clicked', async () => {
    render(
      <Popover>
        <PopoverTrigger>More</PopoverTrigger>
        <PopoverContent>Query details</PopoverContent>
      </Popover>
    )
    expect(screen.queryByText('Query details')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('More'))

    expect(screen.getByText('Query details')).toBeInTheDocument()
  })

  it('closes when the trigger is clicked again', async () => {
    render(
      <Popover>
        <PopoverTrigger>More</PopoverTrigger>
        <PopoverContent>Query details</PopoverContent>
      </Popover>
    )
    const trigger = screen.getByText('More')

    await userEvent.click(trigger)
    expect(screen.getByText('Query details')).toBeInTheDocument()

    await userEvent.click(trigger)
    // Base UI unmounts the popup on close rather than hiding it, so the
    // content is removed from the DOM, not merely made invisible.
    expect(screen.queryByText('Query details')).not.toBeInTheDocument()
  })
})
