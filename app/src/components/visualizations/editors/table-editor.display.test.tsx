/**
 * Choosing how a column is drawn. The renderer honours `displayAs`, but until
 * this existed nothing could set it, so every table was text no matter what the
 * column held.
 */
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { QueryResultColumn } from '@/lib/mock-data'
import type { RedashTableColumnOptions } from '@/services/redash/types'
import { renderWithProviders } from '@/test/utils'
import { TableEditor } from './table-editor'

const COLUMNS: QueryResultColumn[] = [
  { name: 'camera_id', friendly_name: 'camera_id', type: 'string' },
  { name: 'seen', friendly_name: 'seen', type: 'integer' },
]

/**
 * The editor is controlled by `options`, so the harness has to hold them the
 * way the real visualization editor does. With a fixed prop, choosing a kind
 * never reaches the tree and every later assertion describes the harness rather
 * than the component.
 */
function renderEditor(initial: Record<string, unknown> = {}) {
  const onChange = vi.fn()
  function Harness() {
    const [options, setOptions] = useState(initial)
    return (
      <TableEditor
        options={options}
        columns={COLUMNS}
        onChange={(next) => {
          setOptions(next)
          onChange(next)
        }}
      />
    )
  }
  renderWithProviders(<Harness />)
  return onChange
}

/** The config the editor most recently wrote for one column. */
function savedColumn(onChange: ReturnType<typeof vi.fn>, name: string) {
  const last = onChange.mock.calls.at(-1)?.[0] as {
    columns?: RedashTableColumnOptions[]
  }
  return last?.columns?.find((c) => c.name === name)
}

describe('choosing how a column is drawn', () => {
  it('offers the kinds per column', () => {
    renderEditor()

    expect(screen.getByLabelText('Display camera_id as')).toBeInTheDocument()
    expect(screen.getByLabelText('Display seen as')).toBeInTheDocument()
  })

  it('saves the chosen kind', async () => {
    const user = userEvent.setup()
    const onChange = renderEditor()

    await user.click(screen.getByLabelText('Display camera_id as'))
    await user.click(await screen.findByRole('option', { name: 'Link' }))

    expect(savedColumn(onChange, 'camera_id')?.displayAs).toBe('link')
  })

  // The templates are the whole feature: a link column without a URL is text.
  it('reveals the link templates only for a link column', async () => {
    const user = userEvent.setup()
    renderEditor()

    expect(screen.queryByLabelText('camera_id URL template')).not.toBeInTheDocument()

    await user.click(screen.getByLabelText('Display camera_id as'))
    await user.click(await screen.findByRole('option', { name: 'Link' }))

    expect(await screen.findByLabelText('camera_id URL template')).toBeInTheDocument()
  })

  it('saves a link URL template', async () => {
    const user = userEvent.setup()
    const onChange = renderEditor({
      columns: [{ name: 'camera_id', displayAs: 'link', order: 0, visible: true }],
    })

    await user.type(screen.getByLabelText('camera_id URL template'), '/cameras/x')

    expect(savedColumn(onChange, 'camera_id')?.linkUrlTemplate).toBe('/cameras/x')
  })

  it('reveals the image template only for an image column', async () => {
    const user = userEvent.setup()
    renderEditor()

    await user.click(screen.getByLabelText('Display camera_id as'))
    await user.click(await screen.findByRole('option', { name: 'Image' }))

    expect(await screen.findByLabelText('camera_id image URL template')).toBeInTheDocument()
    expect(screen.queryByLabelText('camera_id URL template')).not.toBeInTheDocument()
  })

  // The existing controls have to keep working; this editor already owned
  // visibility, title and order before it owned any of this.
  it('leaves the visibility and title controls in place', () => {
    renderEditor()

    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    // One per column, so this is getAll: the last one is disabled.
    expect(screen.getAllByRole('button', { name: 'Move column down' })).toHaveLength(2)
  })
})
