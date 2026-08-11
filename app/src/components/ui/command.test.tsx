import { beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

// jsdom does not implement ResizeObserver or scrollIntoView, and cmdk uses
// both internally to track list dimensions and scroll the active item into
// view. Stub them for this file only; no other suite needs them.
beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Element.prototype.scrollIntoView = () => {}
})

describe('Command', () => {
  it('filters items as the user types', async () => {
    render(
      <Command>
        <CommandInput placeholder="Type a command" />
        <CommandList>
          <CommandEmpty>No results</CommandEmpty>
          <CommandGroup>
            <CommandItem>Open dashboards</CommandItem>
            <CommandItem>Open queries</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    )
    expect(screen.getByText('Open dashboards')).toBeInTheDocument()
    await userEvent.type(screen.getByPlaceholderText('Type a command'), 'queries')
    expect(screen.queryByText('Open dashboards')).not.toBeInTheDocument()
    expect(screen.getByText('Open queries')).toBeInTheDocument()
  })

  it('fires the item onSelect handler when the user picks an item', async () => {
    const onSelect = vi.fn()
    render(
      <Command>
        <CommandInput placeholder="Type a command" />
        <CommandList>
          <CommandEmpty>No results</CommandEmpty>
          <CommandGroup>
            <CommandItem>Open dashboards</CommandItem>
            <CommandItem onSelect={onSelect}>Open queries</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    )
    await userEvent.click(screen.getByText('Open queries'))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('Open queries')
  })
})
