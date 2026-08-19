import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GTFS_FIELDS } from '@/lib/gtfs-fields'
import { GBFS_STATION_FIELDS } from '@/lib/gbfs-fields'
import { ColumnMapEditor } from './column-map-editor'

describe('the column map editor', () => {
  it('offers every supported field, required ones marked', () => {
    render(
      <ColumnMapEditor
        columns={['bus', 'lat', 'lon']}
        fields={GTFS_FIELDS}
        selection={{}}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByText('vehicle_id')).toBeInTheDocument()
    expect(screen.getByText('timestamp')).toBeInTheDocument()
    // Required is stated in text, not by colour or an asterisk alone.
    expect(screen.getAllByText(/required/i).length).toBeGreaterThan(0)
  })

  it('says so when the query has produced no columns to choose from', () => {
    render(<ColumnMapEditor columns={[]} fields={GTFS_FIELDS} selection={{}} onChange={vi.fn()} />)

    expect(screen.getByText(/has not produced a result yet/i)).toBeInTheDocument()
  })

  it('offers the standard own vocabulary, not always the gtfs-rt one', () => {
    // The editor used to read GTFS_FIELDS directly, so a gbfs binding would
    // have been mapped against fields its serializer never writes.
    render(
      <ColumnMapEditor
        columns={['station_id', 'lat']}
        fields={GBFS_STATION_FIELDS}
        selection={{}}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByText('station_id')).toBeInTheDocument()
    expect(screen.getByText('num_vehicles_available')).toBeInTheDocument()
    expect(screen.queryByText('vehicle_id')).not.toBeInTheDocument()
  })
})
