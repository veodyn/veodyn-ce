import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

describe('Tooltip', () => {
  it('does not render its content when closed', () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Freshness</TooltipTrigger>
          <TooltipContent>Updated 2h ago</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
    expect(screen.queryByText('Updated 2h ago')).not.toBeInTheDocument()
  })

  it('renders its content when open', () => {
    render(
      <TooltipProvider>
        <Tooltip defaultOpen>
          <TooltipTrigger>Freshness</TooltipTrigger>
          <TooltipContent>Updated 2h ago</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
    expect(screen.getByText('Updated 2h ago')).toBeInTheDocument()
  })

  it('shows the content on hover and hides it on unhover', async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Freshness</TooltipTrigger>
          <TooltipContent>Updated 2h ago</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
    const trigger = screen.getByText('Freshness')

    await user.hover(trigger)
    await waitFor(() => {
      expect(screen.getByText('Updated 2h ago')).toBeInTheDocument()
    })

    await user.unhover(trigger)
    await waitFor(() => {
      expect(screen.queryByText('Updated 2h ago')).not.toBeInTheDocument()
    })
  })
})
