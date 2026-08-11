import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import { RowActionsMenu } from './row-actions-menu'

describe('RowActionsMenu', () => {
  it('renders nothing at all when there is nothing the viewer may do', () => {
    // Permission is expressed by handing over a shorter list. A kebab holding
    // one greyed-out item is worse than no kebab: it advertises an action and
    // refuses to say why it is unavailable.
    const { container } = render(<RowActionsMenu label="Actions for Weekly revenue" actions={[]} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('names itself after the object, not after the control', async () => {
    render(
      <RowActionsMenu
        label="Actions for Weekly revenue"
        actions={[{ key: 'archive', label: 'Archive', icon: Archive, onSelect: vi.fn() }]}
      />
    )
    expect(screen.getByRole('button', { name: 'Actions for Weekly revenue' })).toBeInTheDocument()
  })

  it('calls the action it was given', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <RowActionsMenu
        label="Actions for Weekly revenue"
        actions={[{ key: 'archive', label: 'Archive', icon: Archive, onSelect }]}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Actions for Weekly revenue' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('does not trigger the row it sits in', async () => {
    // ItemsTable makes library rows clickable and Enter/Space-operable. Opening
    // the menu must not also navigate to the item.
    const user = userEvent.setup()
    const onRowClick = vi.fn()
    render(
      <table>
        <tbody>
          <tr onClick={onRowClick}>
            <td>
              <RowActionsMenu
                label="Actions for Weekly revenue"
                actions={[{ key: 'archive', label: 'Archive', icon: Archive, onSelect: vi.fn() }]}
              />
            </td>
          </tr>
        </tbody>
      </table>
    )

    await user.click(screen.getByRole('button', { name: 'Actions for Weekly revenue' }))
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('puts the destructive action last, whatever order the caller passed', async () => {
    const user = userEvent.setup()
    render(
      <RowActionsMenu
        label="Actions for Weekly revenue"
        actions={[
          { key: 'delete', label: 'Delete', icon: Trash2, onSelect: vi.fn(), destructive: true },
          { key: 'restore', label: 'Restore', icon: ArchiveRestore, onSelect: vi.fn() },
        ]}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Actions for Weekly revenue' }))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual(['Restore', 'Delete'])
  })

  it('marks the destructive action as destructive, and the other one not', async () => {
    // Asserted on data-variant, NOT on className. Every DropdownMenuItem carries
    // `data-[variant=destructive]:text-destructive` and friends in its class list
    // whatever its variant, so `className).toContain('destructive')` passes for a
    // plain item too and proves nothing. Rendering both variants in one case is
    // the other half of the guard: a component that hardcoded the destructive
    // variant would satisfy a single-item assertion.
    const user = userEvent.setup()
    render(
      <RowActionsMenu
        label="Actions for Weekly revenue"
        actions={[
          { key: 'restore', label: 'Restore', icon: ArchiveRestore, onSelect: vi.fn() },
          { key: 'delete', label: 'Delete', icon: Trash2, onSelect: vi.fn(), destructive: true },
        ]}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Actions for Weekly revenue' }))
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toHaveAttribute(
      'data-variant',
      'destructive'
    )
    expect(screen.getByRole('menuitem', { name: 'Restore' })).not.toHaveAttribute(
      'data-variant',
      'destructive'
    )
  })
})
