import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ColumnMapEditor } from './column-map-editor'

describe('the column map editor', () => {
  it('offers every supported field, required ones marked', () => {
    render(
      <ColumnMapEditor columns={['bus', 'lat', 'lon']} selection={{}} onChange={vi.fn()} />
    )

    expect(screen.getByText('vehicle_id')).toBeInTheDocument()
    expect(screen.getByText('timestamp')).toBeInTheDocument()
    // Required is stated in text, not by colour or an asterisk alone.
    expect(screen.getAllByText(/required/i).length).toBeGreaterThan(0)
  })

  it('says so when the query has produced no columns to choose from', () => {
    render(<ColumnMapEditor columns={[]} selection={{}} onChange={vi.fn()} />)

    expect(screen.getByText(/has not produced a result yet/i)).toBeInTheDocument()
  })
})
