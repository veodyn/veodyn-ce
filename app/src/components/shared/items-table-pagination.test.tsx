import { afterEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { ItemsTable, LIST_PAGE_SIZE, type Column } from './items-table'

// Separate from items-table.test.tsx purely for the file size limit; the sort
// and row-activation behaviour lives there.

afterEach(() => resetStores())

interface ItemFixture {
  id: number
  name: string
}

const columns: Column<ItemFixture>[] = [
  { key: 'name', title: 'Name', sortValue: (item) => item.name, render: (item) => item.name },
  { key: 'id', title: 'Id', render: (item) => String(item.id) },
]

// Counting DOWN, so caller order and alphabetical order disagree: "Item 01" is
// last in the array and first alphabetically. A sort that only saw the visible
// page would therefore produce a visibly different first row than one that saw
// all 30, which is what makes the sort-before-slice test below able to fail.
const manyItems: ItemFixture[] = Array.from({ length: 30 }, (_, i) => ({
  id: i + 1,
  name: `Item ${String(30 - i).padStart(2, '0')}`,
}))

const shortItems: ItemFixture[] = manyItems.slice(0, 3)

function rowNames(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.querySelector('td')?.textContent ?? '')
}

describe('ItemsTable pagination', () => {
  it('renders every row and no paginator when no page size is given', () => {
    // The short lists (a group's members, a dashboard's widgets) opt out by
    // saying nothing, so this must stay the default.
    renderWithProviders(<ItemsTable columns={columns} items={manyItems} rowKey={(i) => i.id} />)

    expect(rowNames()).toHaveLength(30)
    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument()
  })

  it('shows one page at a time once a page size is given', () => {
    renderWithProviders(
      <ItemsTable columns={columns} items={manyItems} rowKey={(i) => i.id} pageSize={25} />
    )

    expect(rowNames()).toHaveLength(25)
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
  })

  // The whole point. Before this, row 26 of a library list was unreachable.
  it('reaches the rows past the first page', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <ItemsTable columns={columns} items={manyItems} rowKey={(i) => i.id} pageSize={25} />
    )
    expect(screen.queryByText('Item 05')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next page' }))

    expect(screen.getByText('Item 05')).toBeInTheDocument()
    expect(rowNames()).toHaveLength(5)
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
  })

  it('goes back', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <ItemsTable columns={columns} items={manyItems} rowKey={(i) => i.id} pageSize={25} />
    )
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await user.click(screen.getByRole('button', { name: 'Previous page' }))

    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
    expect(rowNames()).toHaveLength(25)
  })

  // The reason paging lives in this component rather than in each caller. A
  // caller that sliced first would hand over 25 of 30 rows, and the header
  // would then sort only those while looking exactly like it sorted the lot.
  it('sorts the whole set before slicing it, not just the visible page', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <ItemsTable columns={columns} items={manyItems} rowKey={(i) => i.id} pageSize={25} />
    )

    await user.click(screen.getByRole('button', { name: /name/i }))

    // Ascending over all 30 shows Item 01 to Item 25, so it starts at "Item 01"
    // and pushes "Item 30" onto page 2. Sorting only page 1 (which holds
    // "Item 30" down to "Item 06") would start at "Item 06" and would still
    // have "Item 30" on screen, so both halves of this distinguish the two.
    expect(rowNames()[0]).toBe('Item 01')
    expect(rowNames().at(-1)).toBe('Item 25')
    expect(screen.queryByText('Item 30')).not.toBeInTheDocument()
  })

  it('keeps the page when the reader re-sorts, because it is the same list', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <ItemsTable columns={columns} items={manyItems} rowKey={(i) => i.id} pageSize={25} />
    )
    await user.click(screen.getByRole('button', { name: 'Next page' }))

    await user.click(screen.getByRole('button', { name: /name/i }))

    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
  })

  it('returns to page 1 when the page key changes, because that is a new list', async () => {
    const user = userEvent.setup()
    const { rerender } = renderWithProviders(
      <ItemsTable
        columns={columns}
        items={manyItems}
        rowKey={(i) => i.id}
        pageSize={25}
        pageKey="all"
      />
    )
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()

    rerender(
      <ItemsTable
        columns={columns}
        items={manyItems}
        rowKey={(i) => i.id}
        pageSize={25}
        pageKey="favorites"
      />
    )

    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
    expect(rowNames()[0]).toBe('Item 30')
  })

  // Archiving the last row of the last page, or a search that shortens the
  // list, must not strand the reader on an empty table.
  it('clamps to the last page when the list shrinks under it', async () => {
    const user = userEvent.setup()
    const { rerender } = renderWithProviders(
      <ItemsTable columns={columns} items={manyItems} rowKey={(i) => i.id} pageSize={25} />
    )
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()

    rerender(
      <ItemsTable
        columns={columns}
        items={manyItems.slice(0, 10)}
        rowKey={(i) => i.id}
        pageSize={25}
      />
    )

    expect(rowNames()).toHaveLength(10)
    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument()
  })

  it('hides the paginator when everything fits on one page', () => {
    renderWithProviders(
      <ItemsTable columns={columns} items={shortItems} rowKey={(i) => i.id} pageSize={25} />
    )

    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument()
    expect(rowNames()).toHaveLength(3)
  })

  it('shows the empty state rather than an empty page 1', () => {
    renderWithProviders(
      <ItemsTable
        columns={columns}
        items={[]}
        rowKey={(i) => i.id}
        pageSize={25}
        emptyMessage="Nothing here"
      />
    )

    expect(screen.getByText('Nothing here')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument()
  })

  it('breaks the library lists at the shared page size', () => {
    renderWithProviders(
      <ItemsTable
        columns={columns}
        items={manyItems}
        rowKey={(i) => i.id}
        pageSize={LIST_PAGE_SIZE}
      />
    )

    expect(rowNames()).toHaveLength(LIST_PAGE_SIZE)
  })
})
