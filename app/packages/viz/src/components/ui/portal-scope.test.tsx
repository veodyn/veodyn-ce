import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VeodynProvider } from '../../embed/veodyn-provider'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './dropdown-menu'

function inPortal(text: string) {
  return screen.getByText(text).closest('[data-veodyn-part="portal"]')
}

describe('portalled primitives inside a host scope', () => {
  it('opens a tooltip inside the provider portal', async () => {
    render(
      <VeodynProvider baseUrl="https://veodyn.test">
        <Tooltip defaultOpen>
          <TooltipTrigger>trigger</TooltipTrigger>
          <TooltipContent>tooltip body</TooltipContent>
        </Tooltip>
      </VeodynProvider>
    )

    await screen.findByText('tooltip body')
    expect(inPortal('tooltip body')).not.toBeNull()
  })

  it('opens a menu inside the provider portal', async () => {
    render(
      <VeodynProvider baseUrl="https://veodyn.test">
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>menu item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </VeodynProvider>
    )

    await screen.findByText('menu item')
    expect(inPortal('menu item')).not.toBeNull()
  })

  it('still portals to the document body without a provider', async () => {
    render(
      <Tooltip defaultOpen>
        <TooltipTrigger>trigger</TooltipTrigger>
        <TooltipContent>bare tooltip</TooltipContent>
      </Tooltip>
    )

    await screen.findByText('bare tooltip')
    expect(inPortal('bare tooltip')).toBeNull()
  })
})
