import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { Button } from '@/components/ui/button'
import { ItemsTable, type Column } from './items-table'

afterEach(() => resetStores())

interface ItemFixture {
  id: number
  name: string
  runtime?: number | null
}

const items: ItemFixture[] = [
  { id: 1, name: 'Beta', runtime: 2 },
  { id: 2, name: 'Alpha', runtime: null },
  { id: 3, name: 'Gamma', runtime: 10 },
]

const columns: Column<ItemFixture>[] = [
  { key: 'name', title: 'Name', sortValue: (item) => item.name, render: (item) => item.name },
  {
    key: 'runtime',
    title: 'Runtime',
    sortValue: (item) => item.runtime,
    render: (item) => String(item.runtime ?? '-'),
  },
  { key: 'id', title: 'Id', render: (item) => String(item.id) },
]

function rowNames(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.querySelector('td')?.textContent ?? '')
}

describe('ItemsTable', () => {
  it('leaves the caller order alone until a header is used', () => {
    renderWithProviders(<ItemsTable columns={columns} items={items} rowKey={(i) => i.id} />)

    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Beta')
  })

  it('actually reorders the rows, both ways', async () => {
    // Regression: the chevron moved while the rows stayed in caller order.
    const user = userEvent.setup()
    renderWithProviders(<ItemsTable columns={columns} items={items} rowKey={(i) => i.id} />)

    await user.click(screen.getByRole('button', { name: /name/i }))
    expect(rowNames()).toEqual(['Alpha', 'Beta', 'Gamma'])

    await user.click(screen.getByRole('button', { name: /name/i }))
    expect(rowNames()).toEqual(['Gamma', 'Beta', 'Alpha'])
  })

  it('compares numbers as numbers', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ItemsTable columns={columns} items={items} rowKey={(i) => i.id} />)

    await user.click(screen.getByRole('button', { name: /runtime/i }))

    // Lexically "10" sorts before "2"; numerically it does not.
    expect(rowNames()).toEqual(['Beta', 'Gamma', 'Alpha'])
  })

  it('keeps rows with no value at the bottom in both directions', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ItemsTable columns={columns} items={items} rowKey={(i) => i.id} />)

    await user.click(screen.getByRole('button', { name: /runtime/i }))
    expect(rowNames().at(-1)).toBe('Alpha')

    await user.click(screen.getByRole('button', { name: /runtime/i }))
    expect(rowNames().at(-1)).toBe('Alpha')
  })

  it('reports the sort state to assistive technology', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ItemsTable columns={columns} items={items} rowKey={(i) => i.id} />)

    const nameHeader = screen.getByRole('columnheader', { name: /name/i })
    expect(nameHeader).toHaveAttribute('aria-sort', 'none')

    await user.click(screen.getByRole('button', { name: /name/i }))
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')

    await user.click(screen.getByRole('button', { name: /name/i }))
    expect(nameHeader).toHaveAttribute('aria-sort', 'descending')
  })

  it('gives a column with nothing to sort on no control and no sort state', () => {
    renderWithProviders(<ItemsTable columns={columns} items={items} rowKey={(i) => i.id} />)

    const idHeader = screen.getByRole('columnheader', { name: 'Id' })
    expect(idHeader).not.toHaveAttribute('aria-sort')
    expect(screen.queryByRole('button', { name: 'Id' })).not.toBeInTheDocument()
  })

  it('can be sorted from the keyboard', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ItemsTable columns={columns} items={items} rowKey={(i) => i.id} />)

    await user.tab()
    expect(screen.getByRole('button', { name: /name/i })).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(rowNames()).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('opens on the sort the caller asked for', () => {
    renderWithProviders(
      <ItemsTable
        columns={columns}
        items={items}
        rowKey={(i) => i.id}
        defaultSort={{ key: 'name', dir: 'desc' }}
      />
    )

    expect(rowNames()).toEqual(['Gamma', 'Beta', 'Alpha'])
  })

  it('does not reorder the array it was given', async () => {
    const user = userEvent.setup()
    const caller = [...items]
    renderWithProviders(<ItemsTable columns={columns} items={caller} rowKey={(i) => i.id} />)

    await user.click(screen.getByRole('button', { name: /name/i }))

    expect(caller.map((i) => i.name)).toEqual(['Beta', 'Alpha', 'Gamma'])
  })

  it('calls back with the row that was clicked, after sorting', async () => {
    const user = userEvent.setup()
    const onRowClick = vi.fn()
    renderWithProviders(
      <ItemsTable columns={columns} items={items} rowKey={(i) => i.id} onRowClick={onRowClick} />
    )

    await user.click(screen.getByRole('button', { name: /name/i }))
    await user.click(screen.getAllByRole('row')[1])

    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ name: 'Alpha' }))
  })

  it('activates a row from the keyboard, not only the mouse', async () => {
    const user = userEvent.setup()
    const onRowClick = vi.fn()
    renderWithProviders(
      <ItemsTable columns={columns} items={items} rowKey={(i) => i.id} onRowClick={onRowClick} />
    )

    await user.tab() // name header
    await user.tab() // runtime header
    await user.tab() // first row
    await user.keyboard('{Enter}')

    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ name: 'Beta' }))
  })

  it('also activates a row with the space key', async () => {
    const user = userEvent.setup()
    const onRowClick = vi.fn()
    renderWithProviders(
      <ItemsTable columns={columns} items={items} rowKey={(i) => i.id} onRowClick={onRowClick} />
    )

    await user.tab()
    await user.tab()
    await user.tab()
    await user.keyboard(' ')

    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ name: 'Beta' }))
  })

  it('keeps a static row out of the tab order', () => {
    renderWithProviders(<ItemsTable columns={columns} items={items} rowKey={(i) => i.id} />)

    const bodyRows = screen.getAllByRole('row').slice(1)
    bodyRows.forEach((row) => expect(row).not.toHaveAttribute('tabindex'))
  })

  it('does not swallow a row action button into the row itself when onRowClick is set', () => {
    // Regression: a role="button" row takes its accessible name from descendant
    // text, so a "Restore" button inside a clickable row produced two buttons
    // named "Restore". The row must stay out of the "button" role.
    const columnsWithAction: Column<ItemFixture>[] = [
      ...columns,
      { key: 'action', title: '', render: () => <Button onClick={() => {}}>Restore</Button> },
    ]
    renderWithProviders(
      <ItemsTable
        columns={columnsWithAction}
        items={items}
        rowKey={(i) => i.id}
        onRowClick={() => {}}
      />
    )

    expect(screen.getAllByRole('button', { name: /restore/i })).toHaveLength(items.length)
  })

  it('renders column headers in the mono tracked-label role', () => {
    renderWithProviders(
      <ItemsTable
        columns={[{ key: 'name', title: 'Name', render: (i: { name: string }) => i.name }]}
        items={[{ name: 'a' }]}
        rowKey={(i) => i.name}
      />
    )
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveClass('font-mono')
  })

  it('sizes a sortable header label exactly like a non-sortable one', () => {
    // Regression: Button's own `text-sm` beat the th's inherited `text-xs`, so
    // sortable headers rendered at 14px beside 12px non-sortable ones. The
    // assertion is the relationship, not a literal token, because a class the
    // component renders can be overridden by one it renders later.
    //
    // Resolved from the class cascade, not getComputedStyle: jsdom loads no
    // stylesheet, so fontSize reads 'medium' everywhere and cannot see this
    // defect. e2e/items-table-header.spec.ts asserts the same in a browser.
    renderWithProviders(<ItemsTable columns={columns} items={items} rowKey={(i) => i.id} />)

    const sortable = screen.getByRole('button', { name: /name/i })
    const plain = screen.getByRole('columnheader', { name: 'Id' }).querySelector('span')
    expect(plain).not.toBeNull()

    expect(effectiveFontSize(sortable)).toBe(effectiveFontSize(plain as HTMLElement))
    // ...and that shared size is the one the header cell itself declares.
    expect(effectiveFontSize(sortable)).toBe(
      declaredFontSize(screen.getByRole('columnheader', { name: /name/i }))
    )
  })
})

/** Tailwind font-size utilities only: `text-muted-foreground` is a colour. */
const FONT_SIZE_UTILITY = /^text-(xs|sm|base|[2-9]?xl|\[[^\]]+\])$/

function declaredFontSize(el: HTMLElement): string | undefined {
  return Array.from(el.classList).find((c) => FONT_SIZE_UTILITY.test(c))
}

/** Nearest font-size utility on self or an ancestor, the way the cascade resolves it. */
function effectiveFontSize(el: HTMLElement): string {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const declared = declaredFontSize(node)
    if (declared) return declared
  }
  return 'inherited from the document'
}
