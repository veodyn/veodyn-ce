import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'
import { TablePreviewDialog, type PreviewTarget } from './table-preview-dialog'

// A wide result is the case that matters here and the one jsdom cannot judge:
// it has no layout engine, so every width it reports is 0 and a test cannot
// see a column being clipped. What it CAN pin down is the class contract that
// makes scrolling possible at all, which is what regressed.
//
// The bug, found on stage against a real 17-column ClickHouse table: the table
// rendered 2589px wide inside an 896px dialog, its own overflow-x-auto wrapper
// grew to 2589px instead of constraining, and the dialog clipped it with no
// scrollbar. The last column sat at x=2840 against a dialog edge at x=1374,
// unreachable by any means. Cause: a flex item defaults to min-width:auto, so
// neither the row nor its child would shrink below content width.
//
// Mock data carries 4 to 6 columns and never overflows, which is exactly why
// this survived local testing and had to be caught against real data.
vi.mock('@/hooks/use-table-preview', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/use-table-preview')>(
    '@/hooks/use-table-preview'
  )
  return {
    ...actual,
    useTablePreview: () => ({
      data: {
        data: {
          columns: [
            { name: 'a', type: 'string' },
            { name: 'b', type: 'string' },
          ],
          rows: [{ a: '1', b: '2' }],
        },
        runtime: 0.02,
      },
      error: null,
      isFetching: false,
    }),
  }
})

const target: PreviewTarget = {
  dataSourceId: 1,
  table: {
    name: 'wide_table',
    columns: [
      { name: 'a', type: 'string' },
      { name: 'b', type: 'string' },
    ],
  } as PreviewTarget['table'],
}

describe('TablePreviewDialog', () => {
  it('lets a wider-than-dialog result scroll instead of clipping it', async () => {
    renderWithProviders(<TablePreviewDialog target={target} onClose={vi.fn()} />)

    const table = await screen.findByRole('table')

    // Table's own wrapper is the element that scrolls horizontally.
    const scroller = table.parentElement
    expect(scroller).toHaveClass('overflow-x-auto')

    // The flex row holding it, and the wrapper itself, must both be allowed to
    // shrink below their content. Drop either min-w-0 and the wrapper widens to
    // the table's full width, so overflow-x-auto has nothing left to scroll and
    // the dialog silently clips every column past its right edge.
    const row = scroller?.parentElement
    expect(row).toHaveClass('flex', 'min-h-0', 'min-w-0')
    expect(row?.className).toContain('[&>div]:min-w-0')
  })
})
